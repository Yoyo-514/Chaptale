import type { McpExposure, McpServerConfig } from '@earendil-works/pi-coding-agent';
import { isMcpServerOverride, mcpNamespace, validateMcpServerConfig } from '@earendil-works/pi-mcp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { McpConfigScope, McpExposureView, McpSelectableExposure } from '../protocol.ts';

export const EMPTY_MCP_JSON = '{\n  "mcpServers": {}\n}\n';

const ENV_PLACEHOLDER_RE = /\$\{[^}]*\}/;
const VALID_EXPOSURES = new Set<McpExposure>(['codemode', 'deferred', 'direct', 'hidden']);
const KNOWN_OVERRIDE_KEYS = new Set(['enabled', 'exposure', 'toolExposure']);
const KNOWN_SERVER_EXTRA_KEYS = new Set([
  'type',
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'oauth',
  'description',
  'enabled',
  'timeout',
  'exposure',
  'toolExposure'
]);

export interface McpServerOverrideEntry {
  enabled?: boolean;
  exposure?: McpExposure;
  toolExposure?: Record<string, McpExposure>;
}

export interface ResolvedMcpServerEntry {
  name: string;
  definedIn: McpConfigScope;
  definedWorkId: string | null;
  overriddenInWork: boolean;
  config: McpServerConfig;
  enabled: boolean;
  exposure: McpExposureView;
  /** 授权规则绑定的服务身份：作用域、名称与命令或地址。 */
  fingerprint: string;
  /** 进程级共享连接池键（全局服务与各作品专属服务严格隔离）。 */
  nodeKey: string;
  /** 连接参数摘要；env、headers、超时等变化时共享连接需要重建，启停与暴露方式不计入。 */
  connectionKey: string;
  /** stdio 未显式填 cwd 时采用的默认目录（仅 stdio 服务有意义）。 */
  defaultCwd: string | null;
}

export interface MergedMcpConfigResult {
  globalFile: string;
  globalJson: string;
  globalErrors: string[];
  workFile: string | null;
  workJson: string | null;
  workErrors: string[];
  servers: ResolvedMcpServerEntry[];
}

interface ParsedLayer {
  definitions: Map<string, McpServerConfig>;
  overrides: Map<string, McpServerOverrideEntry>;
  errors: string[];
}

export function globalMcpConfigFile(agentDir: string): string {
  return join(agentDir, 'mcp.json');
}

export function workMcpConfigFile(workFilesDir: string): string {
  return join(dirname(workFilesDir), 'mcp.json');
}

export function computeMcpServerFingerprint(
  definedIn: McpConfigScope,
  definedWorkId: string | null,
  name: string,
  config: McpServerConfig
): string {
  const identity =
    'command' in config
      ? {
          definedIn,
          definedWorkId,
          name,
          kind: 'stdio',
          command: config.command,
          args: config.args ?? [],
          cwd: config.cwd ?? ''
        }
      : {
          definedIn,
          definedWorkId,
          name,
          kind: 'http',
          url: config.url
        };
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
}

export function mcpNodeKey(definedIn: McpConfigScope, definedWorkId: string | null, name: string): string {
  return definedIn === 'global' ? `global:${name}` : `work:${definedWorkId ?? ''}:${name}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkLiteralString(serverName: string, fieldLabel: string, value: string): string | null {
  if (value.startsWith('!')) {
    return `MCP 服务 "${serverName}" 的 ${fieldLabel} 不支持以 "!" 开头的命令注入，请直接填写实际字面值。`;
  }
  if (ENV_PLACEHOLDER_RE.test(value)) {
    return `MCP 服务 "${serverName}" 的 ${fieldLabel} 不支持 "\${...}" 环境变量占位符，请直接填写实际字面值。`;
  }
  return null;
}

function checkLiteralSecrets(serverName: string, raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (raw.auth !== undefined) {
    errors.push(`MCP 服务 "${serverName}" 不支持外部扩展认证提供方，请使用 headers 或 OAuth 登录。`);
  }
  if (isPlainRecord(raw.env)) {
    for (const [key, val] of Object.entries(raw.env)) {
      if (typeof val === 'string') {
        const err = checkLiteralString(serverName, `env.${key}`, val);
        if (err) errors.push(err);
      }
    }
  }
  if (isPlainRecord(raw.headers)) {
    for (const [key, val] of Object.entries(raw.headers)) {
      if (typeof val === 'string') {
        const err = checkLiteralString(serverName, `headers.${key}`, val);
        if (err) errors.push(err);
      }
    }
  }
  if (isPlainRecord(raw.oauth) && typeof raw.oauth.clientSecret === 'string') {
    const err = checkLiteralString(serverName, 'oauth.clientSecret', raw.oauth.clientSecret);
    if (err) errors.push(err);
  }
  return errors;
}

function validateExposureFields(name: string, raw: Record<string, unknown>): string | null {
  if (raw.exposure !== undefined) {
    if (typeof raw.exposure !== 'string' || !VALID_EXPOSURES.has(raw.exposure as McpExposure)) {
      return `MCP 服务 "${name}" 的 exposure 必须是 codemode、deferred、direct 或 hidden。`;
    }
  }
  if (raw.toolExposure !== undefined) {
    if (!isPlainRecord(raw.toolExposure)) {
      return `MCP 服务 "${name}" 的 toolExposure 必须是键值对象。`;
    }
    for (const [toolName, exp] of Object.entries(raw.toolExposure)) {
      if (typeof exp !== 'string' || !VALID_EXPOSURES.has(exp as McpExposure)) {
        return `MCP 服务 "${name}" 的 toolExposure.${toolName} 必须是 codemode、deferred、direct 或 hidden。`;
      }
    }
  }
  return null;
}

function validateOverrideEntry(name: string, raw: Record<string, unknown>): McpServerOverrideEntry | string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    return `MCP 服务名称 "${name}" 仅支持字母、数字、下划线与连字符。`;
  }
  for (const key of Object.keys(raw)) {
    if (!KNOWN_OVERRIDE_KEYS.has(key)) {
      return `MCP 覆盖项 "${name}" 包含不支持的字段 "${key}"（仅支持 enabled、exposure、toolExposure，或提供完整的 command / url）。`;
    }
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    return `MCP 服务 "${name}" 的 enabled 必须是布尔值。`;
  }
  const expErr = validateExposureFields(name, raw);
  if (expErr) return expErr;
  return {
    ...(typeof raw.enabled === 'boolean' ? { enabled: raw.enabled } : {}),
    ...(typeof raw.exposure === 'string' ? { exposure: raw.exposure as McpExposure } : {}),
    ...(isPlainRecord(raw.toolExposure) ? { toolExposure: raw.toolExposure as Record<string, McpExposure> } : {})
  };
}

export function parseMcpConfigText(text: string, scope: McpConfigScope): ParsedLayer {
  const definitions = new Map<string, McpServerConfig>();
  const overrides = new Map<string, McpServerOverrideEntry>();
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    errors.push(`JSON 语法错误：${cause instanceof Error ? cause.message : String(cause)}`);
    return { definitions, overrides, errors };
  }

  if (!isPlainRecord(parsed)) {
    errors.push('顶层配置必须是 JSON 对象（例如 { "mcpServers": {} }）。');
    return { definitions, overrides, errors };
  }

  for (const key of Object.keys(parsed)) {
    if (key !== 'mcpServers' && key !== '$schema') {
      errors.push(`不支持的顶层字段 "${key}"，请将服务定义放在 "mcpServers" 下。`);
    }
  }

  const rawServers = parsed.mcpServers;
  if (rawServers === undefined) return { definitions, overrides, errors };
  if (!isPlainRecord(rawServers)) {
    errors.push('"mcpServers" 必须是键值对象。');
    return { definitions, overrides, errors };
  }

  const namespaces = new Map<string, string>();
  for (const [name, rawEntry] of Object.entries(rawServers)) {
    if (isPlainRecord(rawEntry)) {
      const secretErrors = checkLiteralSecrets(name, rawEntry);
      if (secretErrors.length > 0) {
        errors.push(...secretErrors);
        continue;
      }
      if (scope === 'work' && isMcpServerOverride(rawEntry)) {
        const overrideResult = validateOverrideEntry(name, rawEntry);
        if (typeof overrideResult === 'string') {
          errors.push(overrideResult);
          continue;
        }
        overrides.set(name, overrideResult);
        continue;
      }
      const expErr = validateExposureFields(name, rawEntry);
      if (expErr) {
        errors.push(expErr);
        continue;
      }
      const unknownKey = Object.keys(rawEntry).find(key => !KNOWN_SERVER_EXTRA_KEYS.has(key));
      if (unknownKey) {
        errors.push(`MCP 服务 "${name}" 包含不支持的字段 "${unknownKey}"。`);
        continue;
      }
    }

    const validated = validateMcpServerConfig(name, rawEntry);
    if (validated.kind === 'invalid') {
      errors.push(validated.error);
      continue;
    }

    const ns = mcpNamespace(name);
    const collided = namespaces.get(ns);
    if (collided && collided !== name) {
      errors.push(`MCP 服务 "${name}" 与 "${collided}" 规范化后的工具前缀冲突（均为 ${ns}）。`);
      continue;
    }
    namespaces.set(ns, name);
    definitions.set(name, validated.config as McpServerConfig);
  }

  return { definitions, overrides, errors };
}

async function readMcpJsonOrEmpty(filePath: string): Promise<{ text: string; exists: boolean }> {
  try {
    const text = await readFile(filePath, 'utf8');
    return { text, exists: true };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { text: EMPTY_MCP_JSON, exists: false };
    }
    throw cause;
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}

export async function saveValidatedMcpConfig(filePath: string, scope: McpConfigScope, jsonText: string): Promise<void> {
  const trimmed = jsonText.trim();
  const normalized = trimmed.length === 0 ? EMPTY_MCP_JSON : `${trimmed}\n`;
  const parsed = parseMcpConfigText(normalized, scope);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.join('\n'));
  }
  await writeFileAtomic(filePath, normalized);
}

function detectIndent(text: string): string | number {
  const match = text.match(/\n([ \t]+)"/);
  return match ? match[1]! : 2;
}

export async function patchMcpServerInFile(
  filePath: string,
  scope: McpConfigScope,
  name: string,
  patch: { enabled?: boolean; exposure?: McpSelectableExposure }
): Promise<void> {
  const current = await readMcpJsonOrEmpty(filePath);
  const indent = detectIndent(current.text);
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(current.text);
    if (!isPlainRecord(parsed)) throw new Error('当前 mcp.json 顶层不是对象，请先修复配置文件。');
    root = { ...parsed };
  } catch (cause) {
    throw new Error(
      `当前 mcp.json 存在语法错误，请先修复后再操作：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  const servers = isPlainRecord(root.mcpServers) ? { ...root.mcpServers } : {};
  const existing = servers[name];

  if (existing === undefined) {
    if (scope !== 'work') {
      throw new Error(`未在配置文件中找到 MCP 服务 "${name}"。`);
    }
    const nextOverride: Record<string, unknown> = {};
    if (patch.enabled !== undefined) nextOverride.enabled = patch.enabled;
    if (patch.exposure !== undefined) nextOverride.exposure = patch.exposure;
    servers[name] = nextOverride;
  } else if (isPlainRecord(existing)) {
    const nextEntry: Record<string, unknown> = { ...existing };
    if (patch.enabled !== undefined) nextEntry.enabled = patch.enabled;
    if (patch.exposure !== undefined) nextEntry.exposure = patch.exposure;
    servers[name] = nextEntry;
  } else {
    throw new Error(`MCP 服务 "${name}" 的配置项不是对象。`);
  }

  root.mcpServers = servers;
  const serialized = `${JSON.stringify(root, null, indent)}\n`;
  await saveValidatedMcpConfig(filePath, scope, serialized);
}

const PRESENTATION_KEYS = new Set(['enabled', 'exposure', 'toolExposure', 'description']);

function connectionKeyOf(config: McpServerConfig, defaultCwd: string | null): string {
  return JSON.stringify([Object.entries(config).filter(([key]) => !PRESENTATION_KEYS.has(key)), defaultCwd]);
}

function applyOverride(base: McpServerConfig, override: McpServerOverrideEntry): McpServerConfig {
  return {
    ...base,
    ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
    ...(override.exposure !== undefined ? { exposure: override.exposure } : {}),
    ...(override.toolExposure !== undefined ? { toolExposure: { ...base.toolExposure, ...override.toolExposure } } : {})
  };
}

export async function loadMergedMcpConfig(options: {
  agentDir: string;
  workId: string | null;
  workFilesDir: string | null;
  defaultGlobalCwd?: string;
}): Promise<MergedMcpConfigResult> {
  const globalFile = globalMcpConfigFile(options.agentDir);
  const globalRead = await readMcpJsonOrEmpty(globalFile);
  const globalLayer = parseMcpConfigText(globalRead.text, 'global');

  const workFile = options.workFilesDir ? workMcpConfigFile(options.workFilesDir) : null;
  const workRead = workFile ? await readMcpJsonOrEmpty(workFile) : null;
  const workLayer = workRead ? parseMcpConfigText(workRead.text, 'work') : null;

  const merged = new Map<
    string,
    {
      definedIn: McpConfigScope;
      definedWorkId: string | null;
      overriddenInWork: boolean;
      config: McpServerConfig;
      defaultCwd: string | null;
    }
  >();
  const namespaces = new Map<string, string>();

  for (const [name, config] of globalLayer.definitions) {
    namespaces.set(mcpNamespace(name), name);
    merged.set(name, {
      definedIn: 'global',
      definedWorkId: null,
      overriddenInWork: false,
      config,
      defaultCwd: options.defaultGlobalCwd ?? null
    });
  }

  if (workLayer && options.workId) {
    for (const [name, override] of workLayer.overrides) {
      const target = merged.get(name);
      if (!target) {
        workLayer.errors.push(`作品级覆盖项 "${name}" 未找到同名的全局 MCP 服务定义。`);
        continue;
      }
      merged.set(name, {
        ...target,
        overriddenInWork: true,
        config: applyOverride(target.config, override)
      });
    }

    for (const [name, config] of workLayer.definitions) {
      const ns = mcpNamespace(name);
      const collided = namespaces.get(ns);
      if (collided && collided !== name) {
        workLayer.errors.push(`作品级 MCP 服务 "${name}" 与全局服务 "${collided}" 的工具前缀冲突（均为 ${ns}）。`);
        continue;
      }
      namespaces.set(ns, name);
      merged.set(name, {
        definedIn: 'work',
        definedWorkId: options.workId,
        overriddenInWork: false,
        config,
        defaultCwd: options.workFilesDir
      });
    }
  }

  const servers: ResolvedMcpServerEntry[] = [];
  for (const [name, item] of merged) {
    const enabled = item.config.enabled !== false;
    const exposure = item.config.exposure ?? 'codemode';
    servers.push({
      name,
      definedIn: item.definedIn,
      definedWorkId: item.definedWorkId,
      overriddenInWork: item.overriddenInWork,
      config: item.config,
      enabled,
      exposure,
      fingerprint: computeMcpServerFingerprint(item.definedIn, item.definedWorkId, name, item.config),
      nodeKey: mcpNodeKey(item.definedIn, item.definedWorkId, name),
      connectionKey: connectionKeyOf(item.config, item.defaultCwd),
      defaultCwd: item.defaultCwd
    });
  }

  return {
    globalFile,
    globalJson: globalRead.text,
    globalErrors: globalLayer.errors,
    workFile,
    workJson: workRead?.text ?? null,
    workErrors: workLayer?.errors ?? [],
    servers
  };
}
