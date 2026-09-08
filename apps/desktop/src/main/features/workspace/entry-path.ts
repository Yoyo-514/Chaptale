import path from 'node:path';

const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)
]);

export function isSafeRelativePath(relativePath: string): boolean {
  if (path.isAbsolute(relativePath) || /[\\:\0]/.test(relativePath)) return false;
  return relativePath.split('/').every(part => part && part !== '.' && part !== '..');
}

export function validateEntryName(name: string): string | undefined {
  if (!name) return '名称不能为空';
  if (name === '.' || name === '..' || /[<>:"/\\|?*]/.test(name)) return '名称不能包含 < > : " / \\ | ? *';
  if (!name.isWellFormed() || [...name].some(char => (char.codePointAt(0) ?? 0) < 0x20)) return '名称不能包含控制字符';
  if (name !== name.trim() || name.endsWith('.')) return '名称不能以空格或点结尾';
  if (RESERVED_NAMES.has(name.split('.')[0]?.toUpperCase() ?? '')) return `${name} 是系统保留名称`;
  if (Buffer.byteLength(name) > 240) return '名称过长';
  return undefined;
}
