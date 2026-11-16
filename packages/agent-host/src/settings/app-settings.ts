import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import type {
  AgentInstructions,
  EditMode,
  HostSettings,
  ModelRef,
  NamedInstructions,
  ToolPermission,
  ToolPermissionScope
} from '../protocol.ts';
import { sameFsPath } from '../tools/cwd-paths.ts';

/**
 * 设置文件内容；defaultInstructions 为 null 表示作者尚未设置，新会话使用应用内置指令。
 * lastModel 为作者最近一次选择的模型，新会话沿用；尚未选择过时为 null。
 */
interface AppSettings {
  defaultInstructions: AgentInstructions | null;
  namedInstructions: NamedInstructions[];
  defaultMode: EditMode;
  lastModel: ModelRef | null;
  toolPermissions: ToolPermission[];
  disabledGlobalSkills: string[];
}

const initialSettings: AppSettings = {
  defaultInstructions: null,
  namedInstructions: [],
  defaultMode: 'review',
  lastModel: null,
  toolPermissions: [],
  disabledGlobalSkills: []
};

function normalizeModel(value: ModelRef): ModelRef {
  if (typeof value.provider !== 'string' || !value.provider || typeof value.id !== 'string' || !value.id)
    throw new Error('模型需要供应商与 ID');
  return { provider: value.provider, id: value.id };
}

function normalizeNamed(value: NamedInstructions): NamedInstructions {
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('命名指令需要名称');
  return { name: value.name, entries: normalizeInstructions(value.entries) };
}

function normalizePermissionScope(scope: ToolPermissionScope): ToolPermissionScope {
  if (scope.kind === 'session' && typeof scope.sessionId === 'string' && scope.sessionId.trim()) {
    return { kind: 'session', sessionId: scope.sessionId };
  }
  if (scope.kind === 'work' && typeof scope.workId === 'string' && scope.workId.trim()) {
    return { kind: 'work', workId: scope.workId };
  }
  throw new Error('工具授权作用域无效');
}

function normalizeToolPermission(value: ToolPermission): ToolPermission {
  if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('工具授权需要稳定 ID');
  if (value.capability !== 'fs_read') throw new Error('工具授权能力无效');
  if (typeof value.path !== 'string' || !value.path.trim()) throw new Error('工具授权需要路径');
  if (value.pathKind !== 'directory' && value.pathKind !== 'file') throw new Error('工具授权路径类型无效');
  return {
    id: value.id,
    scope: normalizePermissionScope(value.scope),
    capability: 'fs_read',
    path: value.path,
    pathKind: value.pathKind
  };
}

function sameScope(left: ToolPermissionScope, right: ToolPermissionScope): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === 'session'
    ? left.sessionId === (right as { kind: 'session'; sessionId: string }).sessionId
    : left.workId === (right as { kind: 'work'; workId: string }).workId;
}

function parseSettings(value: AppSettings): AppSettings {
  const namedInstructions = value.namedInstructions.map(normalizeNamed);
  if (new Set(namedInstructions.map(item => item.name)).size !== namedInstructions.length) {
    throw new Error('命名指令名称重复');
  }
  const toolPermissions = value.toolPermissions ? value.toolPermissions.map(normalizeToolPermission) : [];
  if (new Set(toolPermissions.map(item => item.id)).size !== toolPermissions.length) {
    throw new Error('工具授权 ID 重复');
  }
  // oxlint-disable-next-line unicorn/no-array-sort
  const disabledGlobalSkills = Array.isArray(value.disabledGlobalSkills)
    ? [
        ...new Set(
          value.disabledGlobalSkills.map(name => {
            if (typeof name !== 'string' || !name.trim()) throw new Error('停用技能名称无效');
            return name.trim();
          })
        )
      ].sort((a, b) => a.localeCompare(b))
    : [];
  return {
    defaultInstructions: value.defaultInstructions === null ? null : normalizeInstructions(value.defaultInstructions),
    namedInstructions,
    defaultMode: normalizeMode(value.defaultMode),
    // 早于对应字段写入的设置文件保留为空。
    lastModel: value.lastModel ? normalizeModel(value.lastModel) : null,
    toolPermissions,
    disabledGlobalSkills
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
 * 应用数据目录下的本机设置：全局默认指令、命名指令、默认模式与本机工具放行规则。
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
      defaultMode: this.value.defaultMode,
      lastModel: this.value.lastModel,
      toolPermissions: this.value.toolPermissions
    };
  }

  get disabledGlobalSkills(): readonly string[] {
    return this.value.disabledGlobalSkills;
  }

  async setGlobalSkillEnabled(name: string, enabled: boolean): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('技能名称不能为空');
    const set = new Set(this.value.disabledGlobalSkills);
    const changed = enabled ? set.delete(trimmed) : !set.has(trimmed) && Boolean(set.add(trimmed));
    if (!changed) return false;
    // oxlint-disable-next-line unicorn/no-array-sort
    await this.save({ ...this.value, disabledGlobalSkills: [...set].sort((a, b) => a.localeCompare(b)) });
    return true;
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

  permissionsFor(sessionId: string, workId: string | null): ToolPermission[] {
    return this.value.toolPermissions.filter(item =>
      item.scope.kind === 'session'
        ? item.scope.sessionId === sessionId
        : workId !== null && item.scope.workId === workId
    );
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

  /** 与已记录的模型相同时不写文件。 */
  async setLastModel(model: ModelRef): Promise<boolean> {
    const next = normalizeModel(model);
    const last = this.value.lastModel;
    if (last?.provider === next.provider && last.id === next.id) return false;
    await this.save({ ...this.value, lastModel: next });
    return true;
  }

  /** 已存在完全相同的放行规则时不重复写盘。 */
  async addToolPermission(draft: Omit<ToolPermission, 'id'>): Promise<boolean> {
    const normalized = normalizeToolPermission({ id: randomUUID(), ...draft });
    const exists = this.value.toolPermissions.some(
      item =>
        sameScope(item.scope, normalized.scope) &&
        item.capability === normalized.capability &&
        item.pathKind === normalized.pathKind &&
        sameFsPath(item.path, normalized.path)
    );
    if (exists) return false;
    await this.save({ ...this.value, toolPermissions: [...this.value.toolPermissions, normalized] });
    return true;
  }

  async revokeToolPermission(id: string): Promise<void> {
    const list = this.value.toolPermissions;
    if (!list.some(item => item.id === id)) throw new Error('授权规则不存在');
    await this.save({ ...this.value, toolPermissions: list.filter(item => item.id !== id) });
  }

  async clearSessionPermissions(sessionIds: Iterable<string>): Promise<boolean> {
    const ids = new Set(sessionIds);
    if (ids.size === 0) return false;
    const next = this.value.toolPermissions.filter(
      item => !(item.scope.kind === 'session' && ids.has(item.scope.sessionId))
    );
    if (next.length === this.value.toolPermissions.length) return false;
    await this.save({ ...this.value, toolPermissions: next });
    return true;
  }

  async clearWorkPermissions(workId: string, sessionIds: Iterable<string> = []): Promise<boolean> {
    const ids = new Set(sessionIds);
    const next = this.value.toolPermissions.filter(
      item =>
        !(item.scope.kind === 'work' && item.scope.workId === workId) &&
        !(item.scope.kind === 'session' && ids.has(item.scope.sessionId))
    );
    if (next.length === this.value.toolPermissions.length) return false;
    await this.save({ ...this.value, toolPermissions: next });
    return true;
  }

  /** 先写临时文件再替换，中断时保留上一次完整设置。 */
  private async save(next: AppSettings): Promise<void> {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, this.file);
    this.value = next;
  }
}
