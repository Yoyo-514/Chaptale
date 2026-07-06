import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsService } from '../settings.service';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-service-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('creates web-search config when settings already exists', async () => {
    const service = new SettingsService({ rootDir });

    await writeFile(
      service.settingsPath,
      JSON.stringify(
        {
          version: 1,
          storage: { mode: 'global' },
          llm: {}
        },
        null,
        2
      )
    );

    await service.getState();

    const config = JSON.parse(await readFile(service.piWebAccessConfigPath, 'utf8')) as {
      webSearch?: { enabled?: boolean };
      workflow?: string;
    };

    expect(config.webSearch?.enabled).toBe(true);
    expect(config.workflow).toBe('none');
  });

  it('writes web-search config when web access settings are updated', async () => {
    const service = new SettingsService({ rootDir });

    await service.getState();
    await service.update({
      webAccess: {
        webSearchEnabled: false,
        provider: 'brave',
        braveApiKey: 'BSA_test',
        workflow: 'auto-summary',
        youtube: { enabled: false }
      }
    });

    const config = JSON.parse(await readFile(service.piWebAccessConfigPath, 'utf8')) as {
      braveApiKey?: string;
      provider?: string;
      webSearch?: { enabled?: boolean };
      workflow?: string;
      youtube?: { enabled?: boolean };
    };

    expect(config.webSearch?.enabled).toBe(false);
    expect(config.provider).toBe('brave');
    expect(config.braveApiKey).toBe('BSA_test');
    expect(config.workflow).toBe('auto-summary');
    expect(config.youtube?.enabled).toBe(false);
  });
});
