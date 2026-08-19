import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createEditTool,
  createFileTools,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool
} from '../tools';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'chaptale-file-tools-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** 装配后的生产工具面。 */
function assembledTool(name: string) {
  const found = createFileTools(cwd).find(item => item.name === name);

  if (!found) {
    throw new Error(`工具未注册：${name}`);
  }

  return found;
}

describe('安全边界（六工具共用）', () => {
  it('越界路径一律拒绝（../ 逃逸与绝对路径）', async () => {
    // 装配层不再吞异常：抛出后由 AI SDK 转 tool-error，引擎落盘为 isError: true 的
    // 配对结果并把原因交给模型。此前这里有一层 wrapWithErrorText 把异常转成
    // "成功但正文是错误文本"，模型能看懂，但失败标记被抹平——UI 与历史里这六个
    // 最常用的工具永远显示为成功。
    for (const name of ['read', 'write', 'edit', 'ls', 'find', 'grep']) {
      const target = assembledTool(name);
      const payload =
        name === 'read'
          ? { path: '../outside.txt' }
          : name === 'write'
            ? { path: '../outside.txt', content: 'x' }
            : name === 'edit'
              ? { path: '../outside.txt', oldText: 'a', newText: 'b' }
              : name === 'grep'
                ? { pattern: 'x', path: '../../etc' }
                : name === 'find'
                  ? { pattern: '*.txt', path: '../..' }
                  : { path: '../..' };

      await expect(target.execute(payload as never), name).rejects.toThrow(/工作区之外/);
    }
  });

  it('cwd 内合法相对路径正常解析', async () => {
    await writeFile(path.join(cwd, 'ok.txt'), '内容', 'utf8');

    const result = await createReadTool(cwd).execute({ path: 'ok.txt' });

    expect(result.text).toContain('内容');
  });
});

describe('read', () => {
  it('带行号输出；分页与续读提示', async () => {
    const lines = Array.from({ length: 10 }, (_, index) => `第${index + 1}行`);
    await writeFile(path.join(cwd, 'story.md'), lines.join('\n'), 'utf8');

    const read = createReadTool(cwd);
    const page1 = await read.execute({ path: 'story.md', offset: 1, limit: 4 });

    expect(page1.text).toContain('文件共 10 行');
    expect(page1.text).toContain('offset=5');
    expect(page1.text).toContain('第4行');
    expect(page1.text).not.toContain('第5行');

    const page2 = await read.execute({ path: 'story.md', offset: 5, limit: 4 });
    expect(page2.text).toContain('第5行');
  });

  it('二进制拒读；不存在/非文件给出明确文案', async () => {
    await writeFile(path.join(cwd, 'blob.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]), undefined);
    await mkdir(path.join(cwd, 'adir'), { recursive: true });

    const read = createReadTool(cwd);

    expect((await read.execute({ path: 'blob.bin' })).text).toMatch(/二进制/);
    expect((await read.execute({ path: 'ghost.txt' })).text).toMatch(/不存在/);
    expect((await read.execute({ path: 'adir' })).text).toMatch(/不是文件/);
  });
});

describe('grep', () => {
  beforeEach(async () => {
    await mkdir(path.join(cwd, 'chapters'), { recursive: true });
    await writeFile(path.join(cwd, 'chapters', 'one.md'), '雨夜\n晴空\n雨夜降临', 'utf8');
    await writeFile(path.join(cwd, 'notes.txt'), '雨夜灵感', 'utf8');
    await mkdir(path.join(cwd, 'node_modules', 'lib'), { recursive: true });
    await writeFile(path.join(cwd, 'node_modules', 'lib', 'noise.js'), '雨夜噪声', 'utf8');
  });

  it('字面量搜索：递归 + 行号 + 噪声目录跳过', async () => {
    const result = await createGrepTool(cwd).execute({ pattern: '雨夜' });
    const text = result.text;

    expect(text).toContain('chapters/one.md:1:');
    expect(text).toContain('chapters/one.md:3:');
    expect(text).toContain('notes.txt:1:');
    expect(text).not.toContain('noise.js');
  });

  it('正则模式与 include 过滤', async () => {
    const result = await createGrepTool(cwd).execute({ pattern: '^雨夜$', regex: true, include: '*.md' });

    expect(result.text).toContain('chapters/one.md:1:');
    expect(result.text).not.toContain('notes.txt');
  });

  it('无效正则报错；无命中给出扫描计数', async () => {
    const grep = createGrepTool(cwd);

    await expect(grep.execute({ pattern: '([', regex: true })).rejects.toThrow(/正则/);
    expect((await grep.execute({ pattern: '不存在的词' })).text).toMatch(/未找到匹配.*扫描 \d+ 个文件/);
  });

  it('命中上限截断提示', async () => {
    await writeFile(path.join(cwd, 'many.txt'), Array.from({ length: 50 }, () => '目标词').join('\n'), 'utf8');

    const result = await createGrepTool(cwd).execute({ pattern: '目标词', maxResults: 10 });

    expect(result.text).toContain('已达 10 条上限');
  });
});

describe('find', () => {
  beforeEach(async () => {
    await mkdir(path.join(cwd, 'docs', 'deep'), { recursive: true });
    await writeFile(path.join(cwd, 'docs', 'deep', 'a.json'), '{}', 'utf8');
    await writeFile(path.join(cwd, 'docs', 'b.md'), '', 'utf8');
    await writeFile(path.join(cwd, 'root.md'), '', 'utf8');
    await mkdir(path.join(cwd, 'dist'), { recursive: true });
    await writeFile(path.join(cwd, 'dist', 'skip.md'), '', 'utf8');
  });

  it('*.md basename 匹配命中子目录；噪声目录跳过', async () => {
    const result = await createFindTool(cwd).execute({ pattern: '*.md' });

    expect(result.text).toContain('root.md');
    expect(result.text).toContain('docs/b.md');
    expect(result.text).not.toContain('dist');
  });

  it('**/*.json 跨目录匹配', async () => {
    const result = await createFindTool(cwd).execute({ pattern: '**/*.json' });

    expect(result.text).toContain('docs/deep/a.json');
  });

  it('无命中文案', async () => {
    expect((await createFindTool(cwd).execute({ pattern: '*.ghost' })).text).toMatch(/未找到/);
  });
});

describe('ls', () => {
  it('目录在前 + / 后缀排序；空目录文案', async () => {
    await mkdir(path.join(cwd, 'zz-dir'), { recursive: true });
    await writeFile(path.join(cwd, 'a-file.txt'), '', 'utf8');
    await mkdir(path.join(cwd, 'empty'), { recursive: true });

    const ls = createLsTool(cwd);
    const result = await ls.execute({});

    expect(result.text.split('\n').slice(0, 3)).toEqual(['empty/', 'zz-dir/', 'a-file.txt']);
    expect((await ls.execute({ path: 'empty' })).text).toBe('目录为空');
    expect((await ls.execute({ path: 'ghost' })).text).toMatch(/不存在/);
  });
});

describe('write / edit', () => {
  it('write 覆盖 + 父目录创建 + 字节统计', async () => {
    const result = await createWriteTool(cwd).execute({ path: 'new/dir/file.txt', content: '你好' });

    expect(result.text).toMatch(/已写入 new\/dir\/file.txt（6 字节/);
    expect(await readFile(path.join(cwd, 'new', 'dir', 'file.txt'), 'utf8')).toBe('你好');

    await createWriteTool(cwd).execute({ path: 'new/dir/file.txt', content: '覆盖' });
    expect(await readFile(path.join(cwd, 'new', 'dir', 'file.txt'), 'utf8')).toBe('覆盖');
  });

  it('edit 恰好一次才替换；零/多匹配给次数', async () => {
    await writeFile(path.join(cwd, 'doc.md'), '开头。\n中间独特句。\n结尾。', 'utf8');
    const edit = createEditTool(cwd);

    const ok = await edit.execute({ path: 'doc.md', oldText: '中间独特句。', newText: '改写后的句子。' });
    expect(ok.text).toContain('已替换 doc.md 中 1 处文本');
    expect(await readFile(path.join(cwd, 'doc.md'), 'utf8')).toContain('改写后的句子。');

    await writeFile(path.join(cwd, 'dup.md'), '重复\n重复\n重复', 'utf8');
    expect((await edit.execute({ path: 'dup.md', oldText: '重复', newText: 'x' })).text).toMatch(/出现 3 次/);

    expect((await edit.execute({ path: 'doc.md', oldText: '不存在的句子', newText: 'x' })).text).toMatch(/0 次/);
    expect((await edit.execute({ path: 'ghost.md', oldText: 'a', newText: 'b' })).text).toMatch(/不存在/);
  });
});
