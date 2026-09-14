import os from 'node:os';
import path from 'node:path';

/** 远端身份标记：绑定与恢复前都拿它核对"这是不是同一部作品"。 */
export const BACKUP_MARKER_FILE = '.chaptale-backup.json';

/**
 * 非 App Folder 接入时在最顶层下建的容器目录名。
 *
 * App Folder 接入（Dropbox / OneDrive）不套这一层：服务商返回的最顶层本身就是应用专属区域，
 * 再套一层会变成 `/Apps/Chaptale/Chaptale/`。
 */
export const BACKUP_FOLDER_NAME = 'Chaptale';

export type BackupMarker = {
  version: 1;
  /** 对应作品 `chaptale.json` 的 id；对不上就是绑错了目录。 */
  workspaceId: string;
  title: string;
};

export function createMarker(input: { workspaceId: string; title: string }): BackupMarker {
  return { version: 1, workspaceId: input.workspaceId, title: input.title };
}

export function serializeMarker(marker: BackupMarker): string {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

export function parseMarker(text: string): BackupMarker | null {
  let parsed: Partial<BackupMarker>;

  try {
    parsed = JSON.parse(text) as Partial<BackupMarker>;
  } catch {
    return null;
  }

  if (parsed.version !== 1 || typeof parsed.workspaceId !== 'string' || !parsed.workspaceId) {
    return null;
  }

  return { version: 1, workspaceId: parsed.workspaceId, title: typeof parsed.title === 'string' ? parsed.title : '' };
}

/**
 * 归档文件名：`<作品名> <设备名> <yyyyMMdd-HHmmss>.zip`。
 *
 * 时间戳进**文件名**而不是靠远端修改时间：部分同步客户端会改 mtime，
 * 拿它做"什么时候备的"会得到错的答案。
 */
export function archiveFileName(input: { title: string; deviceName: string; at: Date }): string {
  return `${sanitizeName(input.title)} ${sanitizeName(input.deviceName)} ${timestamp(input.at)}.zip`;
}

/** 只按扩展名判断：备份目录里可能混着作者自己放的文件，非 zip 一律不进清单。 */
export function isArchiveFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

export function timestamp(at: Date): string {
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
}

/**
 * 冲突副本名：`<名字> (冲突副本 <时间戳>)<后缀>`。
 *
 * 恢复要覆写或合并本地文件时，先把本地那份按这个名字留档，作者随时能找回原稿。
 * 词汇与 `features/search/index/source-scanner.ts::isConflictCopy` 一致（`冲突副本`），
 * 所以索引会把留档的这份当副本认出来。
 * 造名字在这里、识别在那边：为了一个字符串去引一条 `cloud-sync -> search` 的跨 feature 边不值当。
 */
export function conflictCopyName(relativePath: string, at: Date): string {
  const extension = path.extname(relativePath);
  const base = relativePath.slice(0, relativePath.length - extension.length);

  return `${base} (冲突副本 ${timestamp(at)})${extension}`;
}

/** 本机设备名：进备份文件名，用来分辨“哪台机器备的”。 */
export function deviceName(): string {
  return sanitizeName(os.hostname() || '未命名设备');
}

/** 控制字符（含 DEL）：远端与本地都会惹麻烦，直接剔除。用 Unicode 类别而不是写死码点范围。 */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/** 远端文件名与本地目录名共用的清洗：Dropbox 禁 `/` 与 `\`，Windows 还禁一批符号。 */
export function sanitizeName(value: string): string {
  const cleaned = value
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim();

  return (cleaned || '未命名').slice(0, 120).trim();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
