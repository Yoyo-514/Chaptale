import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const maxNameLength = 64;
const maxDescriptionLength = 1024;
const validNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function validateSkillTemplateInput(name: string, description: string): { name: string; description: string } {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > maxNameLength || !validNamePattern.test(trimmedName)) {
    throw new Error('技能名称需为 1~64 位小写字母、数字或单连字符（如 tang-titles）');
  }
  const trimmedDesc = description.replace(/\r\n/gu, '\n').trim();
  if (!trimmedDesc || trimmedDesc.length > maxDescriptionLength) {
    throw new Error('技能触发简介不能为空，且不超过 1024 字');
  }
  return { name: trimmedName, description: trimmedDesc };
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** 在指定技能根目录下创建标准 `<name>/SKILL.md` 模板，重名时拒绝覆盖。 */
export async function createSkillTemplate(options: {
  rootDir: string;
  name: string;
  description: string;
  disableModelInvocation?: boolean;
}): Promise<string> {
  const { name, description } = validateSkillTemplateInput(options.name, options.description);
  await mkdir(options.rootDir, { recursive: true });
  const targetDir = join(options.rootDir, name);
  const exists = await lstat(targetDir).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (exists) throw new Error(`技能目录“${name}”已存在`);

  await mkdir(targetDir, { recursive: true });
  const filePath = join(targetDir, 'SKILL.md');
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${yamlScalar(description)}`,
    ...(options.disableModelInvocation ? ['disable-model-invocation: true'] : []),
    '---',
    '',
    `# ${name}`,
    '',
    '在此编写本技能的适用场景、核查步骤与输出约定。若有参考资料，可放在同目录的 `references/` 下按相对路径引用。',
    ''
  ];
  await writeFile(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

async function assertNoSymlinks(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new Error(`技能目录包含符号链接“${entry.name}”，出于安全边界拒绝导入`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinks(join(dir, entry.name));
    }
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcChild = join(src, entry.name);
    const destChild = join(dest, entry.name);
    if (entry.isDirectory()) await copyDirectory(srcChild, destChild);
    else if (entry.isFile()) await copyFile(srcChild, destChild);
  }
}

function safeFolderSlug(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/gu, '-')
    .replace(/^\.+/u, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('无法从源路径推导有效的技能目录名');
  }
  return cleaned;
}

async function ensureTargetAbsent(targetDir: string, label: string): Promise<void> {
  const exists = await lstat(targetDir).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  );
  if (exists) throw new Error(`技能目录“${label}”已存在，请先移除旧项或改名后再导入`);
}

/**
 * 导入外部技能文件夹或单个 `.md` 文件到目标技能根目录：
 * - 文件夹须直接含 `SKILL.md`，递归拒绝符号链接，整目录拷入 `<rootDir>/<folderName>`；
 * - `.md` 文件拷入 `<rootDir>/<slug>/SKILL.md`（源文件名本就是 `SKILL.md` 时取其父目录名）。
 */
export async function importSkillSource(options: { rootDir: string; sourcePath: string }): Promise<string[]> {
  const source = resolve(options.sourcePath);
  const sourceLink = await lstat(source);
  if (sourceLink.isSymbolicLink()) {
    throw new Error('不支持直接导入符号链接路径');
  }
  await mkdir(options.rootDir, { recursive: true });

  if (sourceLink.isFile()) {
    if (extname(source).toLowerCase() !== '.md') {
      throw new Error('仅支持导入 .md 技能文件或包含 SKILL.md 的文件夹');
    }
    const base = basename(source, extname(source));
    const slug = safeFolderSlug(base.toUpperCase() === 'SKILL' ? basename(dirname(source)) : base);
    const targetDir = join(options.rootDir, slug);
    await ensureTargetAbsent(targetDir, slug);
    await mkdir(targetDir, { recursive: true });
    await copyFile(source, join(targetDir, 'SKILL.md'));
    return [slug];
  }

  if (sourceLink.isDirectory()) {
    await assertNoSymlinks(source);
    const skillMd = join(source, 'SKILL.md');
    const hasSkillMd = await stat(skillMd).then(
      info => info.isFile(),
      () => false
    );
    if (!hasSkillMd) {
      throw new Error('所选文件夹根目录下未找到 SKILL.md');
    }
    const slug = safeFolderSlug(basename(source));
    const targetDir = join(options.rootDir, slug);
    await ensureTargetAbsent(targetDir, slug);
    await copyDirectory(source, targetDir);
    return [slug];
  }

  throw new Error('不支持的导入源类型');
}

function isDirectEntry(root: string, target: string): string | null {
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  const first = rel.split(sep)[0]!;
  if (!first || first.startsWith('.')) return null;
  return join(root, first);
}

/**
 * 移除指定技能：校验真实路径严格属于 `<rootDir>` 顶层非隐藏条目后，
 * 原子移入 `<rootDir>/.trash/<uuid>/<entryName>`（pi 扫描自动忽略 `.trash`），返回暂存路径供平台移入系统回收站。
 */
export async function removeManagedSkill(options: {
  rootDir: string;
  filePath: string;
}): Promise<{ files: string[]; removedEntryName: string }> {
  const realRoot = await realpath(options.rootDir).catch(() => null);
  const realFile = await realpath(options.filePath).catch(() => null);
  if (!realRoot || !realFile) {
    throw new Error('目标技能文件不存在');
  }
  const topEntry = isDirectEntry(realRoot, realFile);
  if (!topEntry) {
    throw new Error('目标路径不在当前技能目录内');
  }
  const entryName = basename(topEntry);
  const trashSlot = join(realRoot, '.trash', randomUUID());
  await mkdir(trashSlot, { recursive: true });
  const stagedPath = join(trashSlot, entryName);
  await rename(topEntry, stagedPath);
  return { files: [stagedPath], removedEntryName: entryName };
}
