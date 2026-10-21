import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { builtinWritingInstructions } from '../../instructions/builtin.ts';
import { createHostApplication } from '../index.ts';

it('通用 Node 启动入口装配既有工具与指令，并重开本机设置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-bootstrap-'));
  const options = {
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    configDir: join(root, 'config'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'config', 'settings.json')
  };
  try {
    const first = await createHostApplication(options);
    try {
      expect(first.snapshot().cwd).toBe(options.cwd);
      expect(first.snapshot().tools).toEqual(['read', 'ls', 'find', 'grep']);
      expect(first.snapshot().settings.defaultInstructions).toEqual(builtinWritingInstructions);
      await first.execute({ method: 'defaultMode', input: { mode: 'direct' } });
    } finally {
      await first.dispose();
    }
    const reopened = await createHostApplication(options);
    try {
      expect(reopened.snapshot().settings.defaultMode).toBe('direct');
      expect(reopened.snapshot().sessions).toEqual([]);
    } finally {
      await reopened.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
