import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_SYSTEM_PROMPT } from '../../../../modules/prompts/default-system-prompt';
import { resolveSystemPrompt } from '../../../../modules/prompts/resolve-system-prompt';

describe('pi prompt resources', () => {
  let rootDir: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-prompt-resource-'));
    agentDir = path.join(rootDir, 'agent');
    cwd = path.join(rootDir, 'workspace');
    await Promise.all([fs.mkdir(agentDir), fs.mkdir(cwd)]);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  async function load() {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: resolveSystemPrompt
    });
    await loader.reload();
    return loader;
  }

  it('falls back to the Chaptale default when SYSTEM.md is absent', async () => {
    const loader = await load();

    expect(loader.getSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(loader.getAppendSystemPrompt()).toEqual([]);
  });

  it('falls back when an externally edited SYSTEM.md is blank', async () => {
    await fs.writeFile(path.join(agentDir, 'SYSTEM.md'), ' \n', 'utf8');

    const loader = await load();

    expect(loader.getSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('lets pi discover SYSTEM.md and APPEND_SYSTEM.md natively', async () => {
    await fs.writeFile(path.join(agentDir, 'SYSTEM.md'), '文件系统提示', 'utf8');
    await fs.writeFile(path.join(agentDir, 'APPEND_SYSTEM.md'), '文件追加提示', 'utf8');

    const loader = await load();

    expect(loader.getSystemPrompt()).toBe('文件系统提示');
    expect(loader.getAppendSystemPrompt()).toEqual(['文件追加提示']);
  });
});
