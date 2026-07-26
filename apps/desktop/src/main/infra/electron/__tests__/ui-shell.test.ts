import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [] as any[]), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}));

vi.mock('electron', () => electronMock);

import { ElectronUiShell } from '../ui-shell';

function createWindow(isDestroyed = false, send = vi.fn()) {
  return { webContents: { isDestroyed: () => isDestroyed, send } };
}

describe('ElectronUiShell', () => {
  it('broadcasts to every live window', () => {
    const first = createWindow();
    const second = createWindow();
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([first, second]);

    new ElectronUiShell().broadcast('chan', { id: 1 });

    expect(first.webContents.send).toHaveBeenCalledWith('chan', { id: 1 });
    expect(second.webContents.send).toHaveBeenCalledWith('chan', { id: 1 });
  });

  it('skips destroyed windows and swallows send races without failing the caller', () => {
    const destroyed = createWindow(true);
    const racing = createWindow(
      false,
      vi.fn(() => {
        throw new Error('window destroyed');
      })
    );
    const healthy = createWindow();
    electronMock.BrowserWindow.getAllWindows.mockReturnValue([destroyed, racing, healthy]);

    expect(() => new ElectronUiShell().broadcast('chan')).not.toThrow();
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(healthy.webContents.send).toHaveBeenCalledWith('chan', undefined);
  });

  it('resolves the owning window of an ipc event sender', () => {
    const owner = { id: 'window-1' };
    electronMock.BrowserWindow.fromWebContents.mockReturnValue(owner);
    const sender = { id: 'sender' };

    expect(new ElectronUiShell().resolveOwner({ sender } as any)).toBe(owner);
    expect(electronMock.BrowserWindow.fromWebContents).toHaveBeenCalledWith(sender);
  });

  it('picks a directory bound to the requesting window', async () => {
    const owner = { id: 'window-1' };
    electronMock.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:/work'] });

    await expect(new ElectronUiShell().pickDirectory(owner, '选择工作区')).resolves.toBe('C:/work');
    expect(electronMock.dialog.showOpenDialog).toHaveBeenCalledWith(owner, {
      title: '选择工作区',
      properties: ['openDirectory', 'createDirectory']
    });
  });

  it('returns undefined when the save dialog is canceled', async () => {
    electronMock.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' });

    await expect(
      new ElectronUiShell().pickSavePath({ title: '导出', filters: [{ name: 'HTML', extensions: ['html'] }] })
    ).resolves.toBeUndefined();
  });

  it('returns the chosen save path', async () => {
    electronMock.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/out/chat.html' });

    await expect(
      new ElectronUiShell().pickSavePath({ title: '导出', filters: [{ name: 'HTML', extensions: ['html'] }] })
    ).resolves.toBe('C:/out/chat.html');
  });

  it('turns shell.openPath error strings into exceptions', async () => {
    electronMock.shell.openPath.mockResolvedValue('目录不存在');

    await expect(new ElectronUiShell().openPath('C:/missing')).rejects.toThrow('目录不存在');
  });

  it('resolves openPath when the platform reports no error', async () => {
    electronMock.shell.openPath.mockResolvedValue('');

    await expect(new ElectronUiShell().openPath('C:/work')).resolves.toBeUndefined();
  });
});
