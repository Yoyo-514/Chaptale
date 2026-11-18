import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication, type VectorText } from '@chaptale/creation/application';
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

async function work() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-vectors-'));
  const app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const { id } = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  const document = (title: string, content: string) =>
    value(
      app.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title,
          format: 'txt',
          content
        }
      })
    );
  return { rootDir, app, workId: id, document };
}

const qwen = { model: 'Qwen/Qwen3-Embedding-8B', dimensions: 4 };
/** 测试里的向量内容不重要，只要长度一致。 */
const vectors = (texts: readonly VectorText[], width = 4) =>
  texts.map(({ hash }, index) => ({ hash, vector: new Float32Array(width).fill(index + 1) }));

it('作者启动前没有索引；启动后按段保存向量，改过的段落需要重新算', async () => {
  const { app, workId, document } = await work();
  const first = document('第一回', '沈霁在城门外等候。\n顾长风迟迟未到。');
  document('第二回', '雪落了一夜。');
  const index = app.vectorIndex;

  expect(index.status(workId, qwen)).toEqual({
    state: 'none',
    total: 2,
    indexed: 0,
    characters: 32,
    pendingCharacters: 32
  });
  expect(index.usable(workId, qwen)).toBe(false);
  expect(() => index.save(workId, vectors(index.pending(workId)))).toThrow('这部作品还没有建立向量索引');

  index.start(workId, qwen);
  const pending = index.pending(workId);
  // 标题在前，向量带上出处。
  expect(pending.map(text => text.text)).toEqual([
    '第一回\n沈霁在城门外等候。\n顾长风迟迟未到。',
    '第二回\n雪落了一夜。'
  ]);
  index.save(workId, vectors(pending.slice(0, 1)));
  expect(index.status(workId, qwen)).toMatchObject({
    state: 'ready',
    total: 2,
    indexed: 1,
    characters: 32,
    pendingCharacters: 10
  });
  index.save(workId, vectors(pending.slice(1)));
  expect(index.status(workId, qwen)).toMatchObject({ state: 'ready', total: 2, indexed: 2, pendingCharacters: 0 });
  expect(index.usable(workId, qwen)).toBe(true);

  value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: first.id,
        expectedRevisionId: first.revisionId,
        title: first.title,
        format: 'txt',
        content: '沈霁在城门外等候。\n顾长风终于到了。'
      }
    })
  );
  expect(index.pending(workId).map(text => text.text)).toEqual(['第一回\n沈霁在城门外等候。\n顾长风终于到了。']);
  expect(index.status(workId, qwen)).toMatchObject({ state: 'ready', total: 2, indexed: 1 });
});

it('超过一千字的单行在句末切成几块，各算一个向量', async () => {
  const { app, workId, document } = await work();
  const line = [...'雪风月山水云雾'].map(word => `${word.repeat(299)}。`).join('');
  document('长行', line);
  const texts = app.vectorIndex.pending(workId).map(text => text.text.slice('长行\n'.length));
  expect(texts.map(text => text.length)).toEqual([900, 900, 300]);
  expect(texts.join('')).toBe(line);
});

it('换了模型或维度的索引需要重建，重新启动时清空旧向量；向量长度不一致时拒绝保存', async () => {
  const { app, workId, document } = await work();
  document('第一回', '沈霁在城门外等候。');
  const index = app.vectorIndex;
  index.start(workId, qwen);
  index.save(workId, vectors(index.pending(workId)));
  expect(() => index.save(workId, vectors(index.pending(workId).concat({ hash: 'x', text: '' }), 8))).toThrow(
    '服务返回的向量长度与索引里已有的不一致'
  );

  for (const other of [
    { model: 'BAAI/bge-m3', dimensions: 4 },
    { model: qwen.model, dimensions: null }
  ]) {
    expect(index.status(workId, other)).toMatchObject({ state: 'stale', indexed: 0 });
    expect(index.usable(workId, other)).toBe(false);
  }
  // 同一个模型再次启动不动已有的向量。
  index.start(workId, qwen);
  expect(index.status(workId, qwen)).toMatchObject({ state: 'ready', indexed: 1 });
  index.start(workId, { model: 'BAAI/bge-m3', dimensions: null });
  expect(index.status(workId, { model: 'BAAI/bge-m3', dimensions: null })).toMatchObject({
    state: 'ready',
    indexed: 0
  });
  index.reset(workId);
  expect(index.status(workId, qwen)).toMatchObject({ state: 'none' });
});

it('向量索引不进作品包，导出后作品目录可以整体移走', async () => {
  const { rootDir, app, workId, document } = await work();
  document('第一回', '沈霁在城门外等候。');
  app.vectorIndex.start(workId, qwen);
  app.vectorIndex.save(workId, vectors(app.vectorIndex.pending(workId)));
  expect(existsSync(join(rootDir, 'works', workId, 'vectors.sqlite'))).toBe(true);

  const file = join(rootDir, '长夜行.chaptale');
  value(await app.execute({ method: 'exportWorkPackage', input: { workId, path: file } }));
  const packed = new Database(file, { readonly: true });
  try {
    expect(packed.prepare("SELECT name FROM sqlite_master WHERE name IN ('vectors', 'target')").all()).toEqual([]);
  } finally {
    packed.close();
  }
  // 没有留着打开的索引文件，Windows 下目录才能改名。
  value(app.executeAuthor({ method: 'trashWork', input: { commandId: randomUUID(), workId } }));
  const { files } = value(app.executeAuthor({ method: 'purgeWork', input: { commandId: randomUUID(), workId } }));
  for (const dir of files) await rm(dir, { recursive: true });
  expect(existsSync(join(rootDir, 'works', workId))).toBe(false);
});
