import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { CreationEvent, CreationResult, CreationSnapshot, Document, Entry } from '@chaptale/creation/contracts';

const desktop = path.resolve('apps/desktop');
const executable = createRequire(path.join(desktop, 'package.json'))('electron') as string;

test('作品客户端与 Agent 共用真实业务进程，保存冲突、事件及关闭重开保持业务结果', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'chaptale-application-host-'));
  const report = path.join(root, 'result.json');
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  try {
    await promisify(execFile)(
      executable,
      [
        path.resolve('e2e/electron/fixtures/application-process.mjs'),
        root,
        path.join(desktop, 'dist/main/application-host.js'),
        report,
        `--user-data-dir=${path.join(root, 'profile')}`
      ],
      { env, timeout: 25_000 }
    );
    const result = JSON.parse(await readFile(report, 'utf8')) as {
      processCount: number;
      agentSessions: unknown[];
      events: CreationEvent[];
      saved: Entry;
      reopened: Document;
      conflict: CreationResult<Entry>;
      snapshot: CreationSnapshot;
      afterCrash: CreationSnapshot;
      exitMessage: string;
    };
    expect(result.processCount).toBe(1);
    expect(result.agentSessions).toEqual([]);
    expect(result.events.map(event => event.change.kind)).toEqual(['work', 'entry', 'entry']);
    expect(result.reopened).toMatchObject({
      title: '雨夜',
      content: '第一行\r\n第二行',
      revisionId: result.saved.revisionId
    });
    expect(result.conflict).toMatchObject({
      ok: false,
      error: { code: 'revision-conflict', actualRevisionId: result.saved.revisionId }
    });
    expect(result.snapshot).toMatchObject({ kind: 'work', entries: [{ id: result.saved.id, title: '雨夜' }] });
    expect(result.afterCrash).toEqual(result.snapshot);
    expect(result.exitMessage).toContain('应用宿主已退出');
    expect(JSON.stringify(result.events)).not.toContain('第一行');
    expect(JSON.stringify(result.snapshot)).not.toContain('第一行');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
