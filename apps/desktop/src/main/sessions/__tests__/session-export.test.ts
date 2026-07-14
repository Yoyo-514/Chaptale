import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportSessionHtmlToFile } from '../session-export';

import type { PiSessionRepository } from '../../services/session.repository';

const pickSavePath = vi.hoisted(() => vi.fn());
const writeTextFile = vi.hoisted(() => vi.fn());

vi.mock('../../infra/dialog-gateway', () => ({ pickSavePath }));
vi.mock('../../infra/fs-gateway', () => ({ writeTextFile }));

function createRepository() {
  return {
    exportHtml: vi.fn().mockResolvedValue({ html: '<html></html>', suggestedFileName: 'chat.html' })
  } as unknown as PiSessionRepository;
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
