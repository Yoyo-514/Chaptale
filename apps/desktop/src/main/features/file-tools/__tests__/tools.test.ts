import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../../core/tool-protocol/definition';
import { validateToolArguments } from '../../../core/tool-protocol/validation';
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

/** 与生产装配同口径：本机配置目录受保护（它也叫 .chaptale，不能被当成作品根）。 */
const PROTECTED = { protectedRoots: [path.join(os.homedir(), '.chaptale')] };

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'chaptale-file-tools-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

/** 装配后的生产工具面。 */
function assembledTool(name: string, options = PROTECTED): ToolDefinition {
  const found = createFileTools(cwd, options).find(item => item.name === name);

  if (!found) {
    throw new Error(`工具未注册：${name}`);
  }

  return found;
}

/** 规则摘要口径：真实路径（mkdtemp 在 Windows 上可能给 8.3 短名）、正斜杠、大写盘符。 */
async function subjectOf(target: string, directory = false) {
  const real = (await realpath(target)).replaceAll(path.sep, '/').replace(/^[a-z]:/, drive => drive.toUpperCase());
  return directory ? `${real}/` : real;
}

/** 走完授权流程再执行：与装配层一致，把闸门批准的请求原样交给 execute。 */
async function executeAuthorized(name: string, args: Record<string, unknown>, options = PROTECTED) {
  const tool = assembledTool(name, options);
  return tool.execute(args, undefined, { authorized: (await tool.resolvePermission!(args))! });
}

describe('安全边界（六工具共用）', () => {
  it('越界路径未经授权一律拒绝（../ 逃逸与绝对路径）', async () => {
    // 装配层不吞异常：抛出后由 AI SDK 转 tool-error，引擎落盘为 isError: true 的
    // 配对结果并把原因交给模型。就地转成"成功但正文是错误文本"虽然模型也能看懂，
    // 但失败标记会被抹平，UI 与历史里这六个最常用的工具将永远显示为成功。
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

      await expect(target.execute(payload as never), name).rejects.toThrow(/作品之外/);
    }
  });

  it('cwd 内合法相对路径正常解析', async () => {
    await writeFile(path.join(cwd, 'ok.txt'), '内容', 'utf8');

    const result = await createReadTool(cwd).execute({ path: 'ok.txt' });

    expect(result.text).toContain('内容');
  });

  it('六个 schema 都能编译，且放行各自的正常调用', () => {
    // 入参校验是装配期才接上的（core/agent/tools.ts），生产 schema 若有 Compile
    // 编译不了的形状，或严格到连正常调用都拦，都要在这里暴露而不是等运行时。
    const payloads: Record<string, unknown> = {
      read: { path: 'a.md' },
      grep: { pattern: '林晚' },
      find: { pattern: '*.md' },
      ls: { path: '.' },
      write: { path: 'a.md', content: '正文' },
      edit: { path: 'a.md', oldText: '旧', newText: '新' }
    };

    for (const definition of createFileTools(cwd, PROTECTED)) {
      const result = validateToolArguments(definition.name, definition.parameters, payloads[definition.name]);

      expect(result.ok, `${definition.name}: ${result.ok === false ? result.message : ''}`).toBe(true);
    }
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

describe('作品外访问', () => {
  let outside: string;

  beforeEach(async () => {
    outside = await mkdtemp(path.join(os.tmpdir(), 'chaptale-outside-'));
  });

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it('作品内不细化授权；作品外读取升级为 external_read（敏感），目录起点补尾斜杠', async () => {
    await writeFile(path.join(cwd, 'in.md'), '作品内', 'utf8');
    await writeFile(path.join(outside, 'ref.md'), '外部资料', 'utf8');

    await expect(assembledTool('read').resolvePermission!({ path: 'in.md' })).resolves.toBeNull();
    await expect(assembledTool('read').resolvePermission!({ path: path.join(outside, 'ref.md') })).resolves.toEqual({
      capability: 'external_read',
      riskLevel: 'sensitive',
      subject: await subjectOf(path.join(outside, 'ref.md'))
    });

    // 尾斜杠让一条 external_read(目录/*) 规则同时覆盖 ls/grep/find 的起点本身。
    for (const name of ['ls', 'grep', 'find']) {
      await expect(assembledTool(name).resolvePermission!({ pattern: '*', path: outside }), name).resolves.toEqual({
        capability: 'external_read',
        riskLevel: 'sensitive',
        subject: await subjectOf(outside, true)
      });
    }
  });

  it('作品外写入升级为 external_write；非文本、隐藏目录、其他作品在弹卡之前就拒绝', async () => {
    const write = assembledTool('write');

    await expect(
      write.resolvePermission!({ path: path.join(outside, '导出', 'notes.md'), content: 'x' })
    ).resolves.toMatchObject({ capability: 'external_write', riskLevel: 'mutating' });
    await expect(write.resolvePermission!({ path: path.join(outside, 'run.bat'), content: 'x' })).rejects.toThrow(
      /\.md/
    );
    await expect(
      write.resolvePermission!({ path: path.join(outside, '.obsidian', 'a.md'), content: 'x' })
    ).rejects.toThrow(/隐藏/);

    await mkdir(path.join(outside, '另一部作品'));
    await writeFile(path.join(outside, '另一部作品', 'chaptale.json'), '{}', 'utf8');
    await expect(
      assembledTool('edit').resolvePermission!({
        path: path.join(outside, '另一部作品', '正文', '第一章.md'),
        oldText: '旧',
        newText: '新'
      })
    ).rejects.toThrow(/另一部 Chaptale 作品/);
  });

  it('Chaptale 配置目录读写都不开放，也不弹授权卡片', async () => {
    const configRoot = path.join(outside, 'config');
    await mkdir(configRoot);
    await writeFile(path.join(configRoot, 'models.json'), '{"apiKey":"sk-test"}', 'utf8');
    const options = { protectedRoots: [configRoot] };

    await expect(
      assembledTool('read', options).resolvePermission!({ path: path.join(configRoot, 'models.json') })
    ).rejects.toThrow(/配置目录/);
    await expect(
      assembledTool('write', options).resolvePermission!({ path: path.join(configRoot, 'notes.md'), content: 'x' })
    ).rejects.toThrow(/配置目录/);
  });

  it('授权上层目录后，grep/find 遍历时仍跳过其中的 Chaptale 配置目录', async () => {
    const configRoot = path.join(outside, 'config');
    await mkdir(configRoot);
    await mkdir(path.join(outside, 'notes'));
    await writeFile(path.join(configRoot, 'models.json'), '{"apiKey":"sk-test"}', 'utf8');
    await writeFile(path.join(outside, 'notes', 'a.json'), '{"apiKey":"示例"}', 'utf8');
    const options = { protectedRoots: [configRoot] };

    const grep = await executeAuthorized('grep', { pattern: 'apiKey', path: outside }, options);
    const find = await executeAuthorized('find', { pattern: '*.json', path: outside }, options);

    expect(grep.text).toContain('notes/a.json:1:');
    expect(grep.text).not.toContain('sk-test');
    expect(find.text).toContain('notes/a.json');
    expect(find.text).not.toContain('models.json');
  });

  it('作品外路径经链接指回作品内时拒绝：作品内只能用相对路径，草稿边界不能被绕开', async () => {
    await writeFile(path.join(cwd, 'in.md'), '作品内', 'utf8');
    await symlink(cwd, path.join(outside, 'link-to-work'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      assembledTool('read').resolvePermission!({ path: path.join(outside, 'link-to-work', 'in.md') })
    ).rejects.toThrow(/指回作品内/);
  });

  it('执行只认闸门批准的同一目标：没有凭据或目标不一致都拒绝', async () => {
    const target = path.join(outside, 'ref.md');
    await writeFile(target, '外部资料', 'utf8');
    await writeFile(path.join(outside, 'other.md'), '另一份', 'utf8');
    const read = assembledTool('read');
    const authorized = (await read.resolvePermission!({ path: target }))!;

    await expect(read.execute({ path: target })).rejects.toThrow(/作品之外.*需要作者授权/);
    await expect(read.execute({ path: path.join(outside, 'other.md') }, undefined, { authorized })).rejects.toThrow(
      /不一致/
    );
    expect((await read.execute({ path: target }, undefined, { authorized })).text).toContain('外部资料');
  });

  it('授权后 grep/find 输出绝对路径，write/edit 落到作品外的真实位置', async () => {
    await mkdir(path.join(outside, '设定'));
    await writeFile(path.join(outside, '设定', '世界观.md'), '雨城常年下雨', 'utf8');
    const root = await subjectOf(outside);

    expect((await executeAuthorized('grep', { pattern: '雨城', path: outside })).text).toContain(
      `${root}/设定/世界观.md:1:`
    );
    expect((await executeAuthorized('find', { pattern: '设定/*.md', path: outside })).text).toBe(
      `${root}/设定/世界观.md`
    );

    const exported = path.join(outside, '导出', '摘要.md');
    await executeAuthorized('write', { path: exported, content: '第一版' });
    expect(await readFile(exported, 'utf8')).toBe('第一版');

    await executeAuthorized('edit', { path: exported, oldText: '第一版', newText: '第二版' });
    expect(await readFile(exported, 'utf8')).toBe('第二版');
  });
});
