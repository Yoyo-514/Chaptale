import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-file-exchange-'));
  const app = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'storage') }));
  cleanup.push(async () => {
    app.close();
    await rm(root, { recursive: true, force: true });
  });
  const work = value(
    app.executeAuthor({
      method: 'createWork',
      input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
    })
  );
  function directory(title: string, parentId: string | null = null) {
    return value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId,
          section: 'manuscript',
          kind: 'directory',
          title
        }
      })
    );
  }
  function document(title: string, content: string, parentId: string | null = null) {
    return value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId,
          section: 'manuscript',
          kind: 'document',
          title,
          format: 'txt',
          content
        }
      })
    );
  }
  return { root, app, work, directory, document };
}

it('先预览目录层级，再导入原文；重复导入同一计划沿用回执', async () => {
  const { root, app, work } = await setup();
  const source = join(root, '第一卷');
  await mkdir(join(source, '资料'), { recursive: true });
  const body = '\uFEFF---\r\ntitle: 原标题\r\n---\r\n第一章\r\n正文  \r\n';
  await writeFile(join(source, '第一章.TXT'), body);
  await writeFile(join(source, '资料', '设定.md'), '# 标题\n\n内容\n');
  await writeFile(join(source, '封面.png'), '图片占位');
  const plan = value(await app.execute({ method: 'prepareImport', input: { paths: [source] } }));
  expect(plan.entries.map(entry => [entry.title, entry.kind, entry.parentIndex])).toEqual([
    ['第一卷', 'directory', null],
    ['第一章', 'document', 0],
    ['资料', 'directory', 0],
    ['设定', 'document', 2]
  ]);
  expect(plan.skippedPaths).toEqual([join(source, '封面.png')]);
  expect(value(app.executeAuthor({ method: 'snapshot', input: { workId: work.id } }))).toMatchObject({ entries: [] });
  const input = { ...plan, workId: work.id, parentId: null, section: 'manuscript' as const };
  const imported = value(await app.execute({ method: 'importFiles', input }));
  expect(imported.failure).toBeNull();
  expect(imported.entries).toHaveLength(4);
  expect(
    value(
      app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: imported.entries[1]!.id } })
    )
  ).toMatchObject({
    content: body,
    format: 'txt',
    title: '第一章',
    parentId: imported.entries[0]!.id
  });
  expect(value(await app.execute({ method: 'importFiles', input }))).toEqual(imported);
  const snapshot = value(app.executeAuthor({ method: 'snapshot', input: { workId: work.id } }));
  if (snapshot.kind !== 'work') throw new Error('应返回作品快照');
  expect(snapshot.entries).toHaveLength(4);
  expect(await readFile(join(source, '第一章.TXT'), 'utf8')).toBe(body);
});

it('导出按目录位置排列，标题单独输出，重名和 Windows 文件名处理保留原件', async () => {
  const { root, app, work } = await setup();
  const directory = join(root, 'export');
  await mkdir(directory);
  function document(
    title: string,
    content: string,
    section: 'manuscript' | 'resource' = 'manuscript',
    parentId: string | null = null
  ) {
    return value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId,
          section,
          kind: 'document',
          title,
          format: 'txt',
          content
        }
      })
    );
  }
  const first = document('人物/关系', '甲\r\n');
  const second = document('人物/关系', '乙  \n');
  const folder = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'directory',
        title: '卷'
      }
    })
  );
  document('CON', '丙', 'manuscript', folder.id);
  document('尾部. ', '丁');
  document('资料', '不进整本', 'resource');
  value(
    app.executeAuthor({
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: second.id,
        expectedParentId: null,
        expectedPosition: second.position,
        parentId: null,
        beforeEntryId: first.id
      }
    })
  );
  await writeFile(join(directory, '人物_关系.txt'), '既有文件');
  const result = value(
    await app.execute({
      method: 'exportFiles',
      input: {
        workId: work.id,
        directory,
        target: { kind: 'manuscript', format: 'txt' }
      }
    })
  );
  expect(result.failure).toBeNull();
  expect(result.paths).toEqual(
    ['人物_关系 (2).txt', '人物_关系 (3).txt', join('卷', '_CON.txt'), '尾部.txt'].map(name => join(directory, name))
  );
  expect(await readFile(join(directory, '人物_关系.txt'), 'utf8')).toBe('既有文件');
  expect(await readFile(result.paths[0]!, 'utf8')).toBe('人物/关系\n\n乙  \n');
  expect(await readFile(result.paths[1]!, 'utf8')).toBe('人物/关系\n\n甲\r\n');
  const combined = value(
    await app.execute({ method: 'exportFiles', input: { workId: work.id, directory, target: { kind: 'book' } } })
  );
  expect(combined.failure).toBeNull();
  expect(await readFile(combined.paths[0]!, 'utf8')).toBe(
    '人物/关系\n\n乙  \n\n\n人物/关系\n\n甲\r\n\n\n卷\n\nCON\n\n丙\n\n尾部. \n\n丁'
  );
  const markdown = value(
    await app.execute({
      method: 'exportFiles',
      input: {
        workId: work.id,
        directory,
        target: { kind: 'document', documentId: first.id, format: 'markdown' }
      }
    })
  );
  expect(await readFile(markdown.paths[0]!, 'utf8')).toBe('# 人物/关系\n\n甲\r\n');
  expect(
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: first.id } }))
  ).toMatchObject({ title: '人物/关系', content: '甲\r\n' });
});

it('分文件导出保留多卷和嵌套目录，清理路径重名且保留已有文件与目录', async () => {
  const { root, app, work, directory, document } = await setup();
  const first = directory('第一卷/');
  const nested = directory('CON', first.id);
  const deeper = directory('尾部. ', nested.id);
  const body = '\uFEFF甲\r\n乙\n末尾  \r\n';
  const chapter = document('章:节', body, deeper.id);
  document('同名', '第一份', first.id);
  document('同名', '第二份', first.id);
  const second = directory('第一卷?');
  document('同名', '第三份', second.id);
  directory('空卷');
  const output = join(root, '输出');
  await mkdir(join(output, '第一卷_'), { recursive: true });
  await writeFile(join(output, '第一卷_', '保留.txt'), '原件');
  await writeFile(join(output, '第一卷_ (2)'), '占用目录名称的文件');
  const report = value(
    await app.execute({
      method: 'exportFiles',
      input: {
        workId: work.id,
        directory: output,
        target: { kind: 'manuscript', format: 'markdown' }
      }
    })
  );
  expect(report.failure).toBeNull();
  expect(report.paths).toEqual([
    join(output, '第一卷_ (3)', '_CON', '尾部', '章_节.md'),
    join(output, '第一卷_ (3)', '同名.md'),
    join(output, '第一卷_ (3)', '同名 (2).md'),
    join(output, '第一卷_ (4)', '同名.md')
  ]);
  expect(await Promise.all(report.paths.map(path => readFile(path, 'utf8')))).toEqual([
    `# 章:节\n\n${body}`,
    '# 同名\n\n第一份',
    '# 同名\n\n第二份',
    '# 同名\n\n第三份'
  ]);
  expect(await readdir(join(output, '空卷'))).toEqual([]);
  expect(await readFile(join(output, '第一卷_', '保留.txt'), 'utf8')).toBe('原件');
  expect(await readFile(join(output, '第一卷_ (2)'), 'utf8')).toBe('占用目录名称的文件');
  const single = value(
    await app.execute({
      method: 'exportFiles',
      input: {
        workId: work.id,
        directory: output,
        target: { kind: 'document', documentId: chapter.id, format: 'txt' }
      }
    })
  );
  expect(single.paths).toEqual([join(output, '章_节.txt')]);
  expect(await readFile(single.paths[0]!, 'utf8')).toBe(`章:节\n\n${body}`);
  expect(
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: chapter.id } }))
  ).toMatchObject({ title: '章:节', parentId: deeper.id, content: body });
});

it('整本按当前目录顺序输出卷、嵌套目录和章节标题，正文字符原样保留', async () => {
  const { root, app, work, directory, document } = await setup();
  const first = directory('第一卷');
  const nested = directory('第一幕', first.id);
  document('同名', '甲\r\n', nested.id);
  const second = directory('第二卷');
  document('同名', '乙  \n', second.id);
  document('尾声', '末尾');
  value(
    app.executeAuthor({
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: second.id,
        expectedParentId: null,
        expectedPosition: second.position,
        parentId: null,
        beforeEntryId: first.id
      }
    })
  );
  const report = value(
    await app.execute({
      method: 'exportFiles',
      input: {
        workId: work.id,
        directory: root,
        target: { kind: 'book' }
      }
    })
  );
  expect(report.failure).toBeNull();
  expect(await readFile(report.paths[0]!, 'utf8')).toBe(
    '第二卷\n\n同名\n\n乙  \n\n\n第一卷\n\n第一幕\n\n同名\n\n甲\r\n\n\n尾声\n\n末尾'
  );
});

it('并发分文件导出各自保留目录，导出期间的改名和保存留给下一次', async () => {
  const { root, app, work, directory, document } = await setup();
  const folder = directory('原卷名');
  const chapter = document('原章名', '原正文\r\n', folder.id);
  const command = {
    method: 'exportFiles' as const,
    input: {
      workId: work.id,
      directory: root,
      target: { kind: 'manuscript' as const, format: 'txt' as const }
    }
  };
  const first = app.execute(command);
  const second = app.execute(command);
  value(
    app.executeAuthor({
      method: 'renameEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        entryId: folder.id,
        expectedRevisionId: folder.revisionId,
        title: '新卷名'
      }
    })
  );
  value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: chapter.id,
        expectedRevisionId: chapter.revisionId,
        title: '新章名',
        format: 'txt',
        content: '新正文'
      }
    })
  );
  const reports = (await Promise.all([first, second])).map(value);
  expect(reports.map(report => report.failure)).toEqual([null, null]);
  expect(new Set(reports.flatMap(report => report.paths))).toEqual(
    new Set([join(root, '原卷名', '原章名.txt'), join(root, '原卷名 (2)', '原章名.txt')])
  );
  for (const report of reports) expect(await readFile(report.paths[0]!, 'utf8')).toBe('原章名\n\n原正文\r\n');
});

it('真实文件解码失败报告已完成项，修复源文件后重试不重复创建', async () => {
  const { root, app, work } = await setup();
  const source = join(root, '来源');
  await mkdir(source);
  await writeFile(join(source, '1.txt'), '第一份');
  await writeFile(join(source, '2.txt'), Buffer.from([0xff]));
  const plan = value(await app.execute({ method: 'prepareImport', input: { paths: [source] } }));
  const input = { ...plan, workId: work.id, parentId: null, section: 'resource' as const };
  const partial = value(await app.execute({ method: 'importFiles', input }));
  expect(partial.entries).toHaveLength(2);
  expect(partial.failure).toMatchObject({ index: 2, message: expect.any(String) });
  await writeFile(join(source, '2.txt'), '恢复的原文\r\n');
  const complete = value(await app.execute({ method: 'importFiles', input }));
  expect(complete.failure).toBeNull();
  expect(complete.entries).toHaveLength(3);
  expect(complete.entries.slice(0, 2)).toEqual(partial.entries);
  const snapshot = value(app.executeAuthor({ method: 'snapshot', input: { workId: work.id } }));
  if (snapshot.kind !== 'work') throw new Error('应返回作品快照');
  expect(snapshot.entries).toHaveLength(3);
  expect(
    value(
      app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: complete.entries[2]!.id } })
    )
  ).toMatchObject({ content: '恢复的原文\r\n', section: 'resource' });
});

it('整份导入计划先校验层级，错误的后续父节点不会造成前半段写入', async () => {
  const { root, app, work } = await setup();
  await writeFile(join(root, '原文.txt'), '原文');
  const plan = value(await app.execute({ method: 'prepareImport', input: { paths: [join(root, '原文.txt')] } }));
  const invalid = {
    ...plan,
    entries: [...plan.entries, { ...plan.entries[0]!, parentIndex: 0 }],
    workId: work.id,
    parentId: null,
    section: 'manuscript' as const
  };
  expect(await app.execute({ method: 'importFiles', input: invalid })).toMatchObject({
    ok: false,
    error: { code: 'failed', message: expect.stringContaining('父目录') }
  });
  expect(value(app.executeAuthor({ method: 'snapshot', input: { workId: work.id } }))).toMatchObject({ entries: [] });
  expect(await app.execute({ method: 'prepareImport', input: { paths: ['relative.txt'] } })).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('绝对路径') }
  });
  expect(await app.execute({ method: 'prepareImport', input: { paths: [], caller: 'author' } })).toMatchObject({
    ok: false,
    error: { code: 'invalid-request' }
  });
});

it('导出固定开始时的修订；并发导出分别创建文件并保留已有同名文件', async () => {
  const { root, app, work } = await setup();
  const entry = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '章节',
        format: 'txt',
        content: '导出前\r\n'
      }
    })
  );
  await writeFile(join(root, '章节.txt'), '旧导出');
  const command = {
    method: 'exportFiles' as const,
    input: {
      workId: work.id,
      directory: root,
      target: { kind: 'document' as const, documentId: entry.id, format: 'txt' as const }
    }
  };
  const first = app.execute(command);
  const second = app.execute(command);
  value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: '已改标题',
        format: 'txt',
        content: '导出期间改稿'
      }
    })
  );
  const reports = (await Promise.all([first, second])).map(value);
  expect(reports.map(report => report.failure)).toEqual([null, null]);
  expect(reports.map(report => report.paths.length)).toEqual([1, 1]);
  expect(new Set(reports.flatMap(report => report.paths))).toEqual(
    new Set([join(root, '章节 (2).txt'), join(root, '章节 (3).txt')])
  );
  for (const report of reports) expect(await readFile(report.paths[0]!, 'utf8')).toBe('章节\n\n导出前\r\n');
  expect(await readFile(join(root, '章节.txt'), 'utf8')).toBe('旧导出');
});

it.each(['document', 'directory'] as const)('后续%s导出失败时返回已完成文件，原作品和既有文件保留', async kind => {
  const { root, app, work, document, directory: createDirectory } = await setup();
  const first = document('正常', '正文');
  const failing = kind === 'document' ? document('...', '正文') : createDirectory('...');
  const directory = join(root, '输出');
  await mkdir(directory);
  const report = value(
    await app.execute({
      method: 'exportFiles',
      input: { workId: work.id, directory, target: { kind: 'manuscript', format: 'markdown' } }
    })
  );
  expect(report.paths).toEqual([join(directory, '正常.md')]);
  expect(report.failure?.message).toContain('有效文件名');
  expect(report.failure?.documentId).toBe(kind === 'document' ? failing.id : null);
  expect(
    value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: first.id } }))
  ).toMatchObject({ title: '正常', content: '正文' });
  expect(await readdir(directory)).toEqual(['正常.md']);
  expect(await readFile(report.paths[0]!, 'utf8')).toBe('# 正常\n\n正文');
});
