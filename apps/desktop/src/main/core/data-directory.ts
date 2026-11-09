import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { DataDirectoryStatus } from '../../bridge/data-directory';
import type { SettingsService } from './settings/service';

/** 作品库文件；文件夹里有它就是已有的 Chaptale 数据目录。 */
const libraryFile = 'library.sqlite';
/** 系统自动生成的文件，不算文件夹里的其他文件。 */
const systemFiles = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

/**
 * 作品与会话历史所在的数据目录。本进程第一次确认可用的位置即为使用中的位置，
 * 之后保存的新位置在重启后生效。
 */
export class DataDirectory {
  private readonly settings: SettingsService;
  private active?: string;

  constructor(settings: SettingsService) {
    this.settings = settings;
  }

  async status(): Promise<DataDirectoryStatus> {
    let saved = (await this.settings.readSettings()).dataDir;
    if (!saved) {
      // 已有作品库的旧位置视为已经选择，不再询问。
      const legacy = path.join(this.settings.rootDir, 'creation');
      if (!(await exists(path.join(legacy, libraryFile))))
        return { kind: 'unset', suggested: path.join(this.settings.rootDir, 'data') };
      await this.settings.setDataDir(legacy);
      saved = legacy;
    }
    if (this.active) return { kind: 'ready', path: this.active, next: saved === this.active ? null : saved };
    const stat = await fs.stat(saved).catch(() => undefined);
    if (!stat)
      return {
        kind: 'unavailable',
        path: saved,
        reason: '找不到这个文件夹。移动硬盘可能未连接，或文件夹已被移动、改名。'
      };
    if (!stat.isDirectory()) return { kind: 'unavailable', path: saved, reason: '这个路径不是文件夹。' };
    this.active = saved;
    return { kind: 'ready', path: saved, next: null };
  }

  /** 校验并保存作者选择的位置；不存在的文件夹会被创建。 */
  async choose(target: string): Promise<DataDirectoryStatus> {
    if (!path.isAbsolute(target)) throw new Error('请选择完整的文件夹路径');
    const stat = await fs.stat(target).catch(() => undefined);
    if (stat && !stat.isDirectory()) throw new Error('请选择文件夹');
    if (stat) {
      const names = await fs.readdir(target);
      const usable = names.includes(libraryFile) || names.every(name => systemFiles.has(name.toLowerCase()));
      if (!usable)
        throw new Error(
          '这个文件夹里已有其他文件。请选择空文件夹，或已有的 Chaptale 数据文件夹（含 library.sqlite）。'
        );
    } else {
      await fs.mkdir(target, { recursive: true });
    }
    await this.settings.setDataDir(target);
    return this.status();
  }

  /** 应用宿主启动时取使用中的位置；界面在可用之前不会请求宿主。 */
  async resolve(): Promise<string> {
    const status = await this.status();
    if (status.kind !== 'ready') throw new Error('数据目录尚未就绪，请先选择数据存放位置');
    return status.path;
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false
  );
}
