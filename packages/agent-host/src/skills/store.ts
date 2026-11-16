import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const workDisabledFileName = '.disabled.json';

interface WorkDisabledPayload {
  disabled: string[];
}

export function globalSkillsDir(agentDir: string): string {
  return join(agentDir, 'skills');
}

export function workSkillsDir(workFilesDir: string): string {
  return join(dirname(workFilesDir), 'skills');
}

export async function readWorkDisabledSkills(workSkillsRoot: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(join(workSkillsRoot, workDisabledFileName), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as WorkDisabledPayload;
    if (!Array.isArray(parsed.disabled)) throw new Error('invalid');
    // oxlint-disable-next-line unicorn/no-array-sort
    return [
      ...new Set(
        parsed.disabled.map(name => {
          if (typeof name !== 'string' || !name.trim()) throw new Error('invalid');
          return name.trim();
        })
      )
    ].sort((a, b) => a.localeCompare(b));
  } catch {
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new Error('作品技能配置文件损坏，原文件未被修改');
  }
}

export async function writeWorkDisabledSkills(workSkillsRoot: string, names: readonly string[]): Promise<void> {
  await mkdir(workSkillsRoot, { recursive: true });
  // oxlint-disable-next-line unicorn/no-array-sort
  const normalized = [...new Set(names.map(name => name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const target = join(workSkillsRoot, workDisabledFileName);
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify({ disabled: normalized }, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

export async function setWorkSkillEnabled(workSkillsRoot: string, name: string, enabled: boolean): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('技能名称不能为空');
  const current = await readWorkDisabledSkills(workSkillsRoot);
  const set = new Set(current);
  const changed = enabled ? set.delete(trimmed) : !set.has(trimmed) && Boolean(set.add(trimmed));
  if (!changed) return false;
  await writeWorkDisabledSkills(workSkillsRoot, [...set]);
  return true;
}
