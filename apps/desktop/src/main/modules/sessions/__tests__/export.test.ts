import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportSessionHtmlToFile } from '../export';
import type { SessionRepository } from '../repository';

const pickSavePath = vi.hoisted(() => vi.fn());
const writeTextFile = vi.hoisted(() => vi.fn());

vi.mock('../../../infra/electron/dialog', () => ({ pickSavePath }));
vi.mock('../../../infra/filesystem/files', () => ({ writeTextFile }));

function createRepository() {
  return {
    exportHtml: vi.fn().mockResolvedValue({ html: '<html></html>', suggestedFileName: 'chat.html' })
  } as unknown as SessionRepository;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportSessionHtmlToFile', () => {
  it('writes the exported html to the picked path', async () => {
    pickSavePath.mockResolvedValue('C:/out/chat.html');
    const repository = createRepository();

    await expect(exportSessionHtmlToFile(repository, 'session-1')).resolves.toBe('C:/out/chat.html');
    expect(repository.exportHtml).toHaveBeenCalledWith('session-1');
    expect(writeTextFile).toHaveBeenCalledWith('C:/out/chat.html', '<html></html>');
  });

  it('returns null without writing when the dialog is canceled', async () => {
    pickSavePath.mockResolvedValue(undefined);

    await expect(exportSessionHtmlToFile(createRepository(), 'session-1')).resolves.toBeNull();
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
