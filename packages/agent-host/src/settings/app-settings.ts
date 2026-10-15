import { readFile, rename, writeFile } from 'node:fs/promises';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import type { AgentInstructions, EditMode, HostSettings, NamedInstructions } from '../protocol.ts';

/** 设置文件内容；defaultInstructions 为 null 表示作者尚未设置，新会话使用应用内置指令。 */
interface AppSettings {
  defaultInstructions: AgentInstructions | null;
  namedInstructions: NamedInstructions[];
  defaultMode: EditMode;
}

const initialSettings: AppSettings = { defaultInstructions: null, namedInstructions: [], defaultMode: 'review' };

function normalizeNamed(value: NamedInstructions): NamedInstructions {
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('命名指令需要名称');
  return { name: value.name, entries: normalizeInstructions(value.entries) };
}

function parseSettings(value: AppSettings): AppSettings {
  const namedInstructions = value.namedInstructions.map(normalizeNamed);
  if (new Set(namedInstructions.map(item => item.name)).size !== namedInstructions.length) {
    throw new Error('命名指令名称重复');
  }
  return {
    defaultInstructions: value.defaultInstructions === null ? null : normalizeInstructions(value.defaultInstructions),
    namedInstructions,
    defaultMode: normalizeMode(value.defaultMode)
  };
}

/** 文件不存在时使用初始设置；内容损坏时拒绝装配，不覆盖原文件。 */
async function loadSettings(file: string): Promise<AppSettings> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return structuredClone(initialSettings);
    throw error;
  }
  try {
    return parseSettings(JSON.parse(text) as AppSettings);
  } catch {
    // 解析错误可能回显设置内容，不附加原始错误。
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new Error('应用设置文件损坏，原文件未被修改');
  }
}

/**
 * 应用数据目录下的本机设置：全局默认指令、命名指令与默认模式。
 * 不进作品备份，不复用 pi 的 SettingsManager；每次修改先写入文件，成功后才更新内存。
 */
export class AppSettingsStore {
  private readonly file: string;
  private readonly builtin: AgentInstructions;
  private value: AppSettings;

  private constructor(file: string, builtin: AgentInstructions, value: AppSettings) {
    this.file = file;
    this.builtin = builtin;
    this.value = value;
  }

  static async open(file: string, builtin: AgentInstructions): Promise<AppSettingsStore> {
    return new AppSettingsStore(file, builtin, await loadSettings(file));
  }

  view(): HostSettings {
    return {
      defaultInstructions: this.value.defaultInstructions ?? this.builtin,
      namedInstructions: this.value.namedInstructions,
      defaultMode: this.value.defaultMode
    };
  }

  /** 新会话复制的指令：省略名称时为全局默认，否则为同名命名指令。 */
  instructionsFor(name?: string): AgentInstructions {
    if (name === undefined) return structuredClone(this.view().defaultInstructions);
    const named = this.value.namedInstructions.find(item => item.name === name);
    if (!named) throw new Error('命名指令不存在');
    return structuredClone(named.entries);
  }

  get defaultMode(): EditMode {
    return this.value.defaultMode;
  }

  setDefaultInstructions(entries: AgentInstructions): Promise<void> {
    return this.save({ ...this.value, defaultInstructions: normalizeInstructions(entries) });
  }

  /** 同名时原位覆盖，否则追加到末尾。 */
  saveNamed(value: NamedInstructions): Promise<void> {
    const named = normalizeNamed(value);
    const list = this.value.namedInstructions;
    const namedInstructions = list.some(item => item.name === named.name)
      ? list.map(item => (item.name === named.name ? named : item))
      : [...list, named];
    return this.save({ ...this.value, namedInstructions });
  }

  deleteNamed(name: string): Promise<void> {
    const list = this.value.namedInstructions;
    if (!list.some(item => item.name === name)) throw new Error('命名指令不存在');
    return this.save({ ...this.value, namedInstructions: list.filter(item => item.name !== name) });
  }

  setDefaultMode(mode: EditMode): Promise<void> {
    return this.save({ ...this.value, defaultMode: normalizeMode(mode) });
  }

  /** 先写临时文件再替换，中断时保留上一次完整设置。 */
  private async save(next: AppSettings): Promise<void> {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
    this.value = next;
  }
}
