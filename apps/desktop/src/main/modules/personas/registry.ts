import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PersonaDefinition, PersonaDiagnostic, PersonaSource } from '@chaptale/shared';
import { PersonaFrontmatterValidator } from '@chaptale/shared';

import type { FrontmatterParser } from '../frontmatter/types';

export type PersonaRegistryOptions = {
  parseFrontmatter: FrontmatterParser;
  /** 构建期打包的内置 persona 源文本。 */
  builtinSources: readonly string[];
  /** 用户级 persona 目录（~/.chaptale/personas）。 */
  userPersonasDir: string;
};

export type PersonaLoadResult = {
  personas: PersonaDefinition[];
  diagnostics: PersonaDiagnostic[];
};

/**
 * persona 注册表（只读）。
 *
 * 与 SkillsProvider 同范式：每次 load 全量扫描返回快照，不做常驻缓存——
 * persona 变更后下一次会话创建即生效，无失效通知负担。
 * 三级来源同 id 覆盖，优先级：作品级 > 用户级 > 内置。
 */
export class PersonaRegistry {
  constructor(private readonly options: PersonaRegistryOptions) {}

  async load(cwd: string): Promise<PersonaLoadResult> {
    const diagnostics: PersonaDiagnostic[] = [];
    const byId = new Map<string, PersonaDefinition>();

    // 低优先级先写入，高优先级同 id 覆盖。
    for (const source of this.options.builtinSources) {
      this.register(byId, diagnostics, source, 'builtin', undefined);
    }

    for (const { content, filePath } of await readPersonaFiles(this.options.userPersonasDir)) {
      this.register(byId, diagnostics, content, 'user', filePath);
    }

    const workspacePersonasDir = path.join(cwd, '.chaptale', 'personas');
    for (const { content, filePath } of await readPersonaFiles(workspacePersonasDir)) {
      this.register(byId, diagnostics, content, 'workspace', filePath);
    }

    return { personas: [...byId.values()], diagnostics };
  }

  /** 按 id 取单个 persona；未启用（enabled: false）的 persona 不可获取。 */
  async get(cwd: string, id: string): Promise<PersonaDefinition | undefined> {
    const { personas } = await this.load(cwd);
    return personas.find(persona => persona.id === id && persona.enabled !== false);
  }

  private register(
    byId: Map<string, PersonaDefinition>,
    diagnostics: PersonaDiagnostic[],
    content: string,
    source: PersonaSource,
    filePath: string | undefined
  ) {
    let parsed: ReturnType<FrontmatterParser>;

    try {
      parsed = this.options.parseFrontmatter(content);
    } catch (error) {
      diagnostics.push({ source, filePath, message: `frontmatter 解析失败：${toMessage(error)}` });
      return;
    }

    if (!PersonaFrontmatterValidator.Check(parsed.frontmatter)) {
      const [firstError] = [...PersonaFrontmatterValidator.Errors(parsed.frontmatter)];
      diagnostics.push({
        source,
        filePath,
        message: `frontmatter 校验失败：${firstError ? `${firstError.instancePath} ${firstError.message}` : '未知字段错误'}`
      });
      return;
    }

    if (!parsed.body.trim()) {
      diagnostics.push({ source, filePath, message: 'persona 正文（系统提示词）不能为空' });
      return;
    }

    byId.set(parsed.frontmatter.id, {
      ...parsed.frontmatter,
      body: parsed.body,
      source,
      ...(filePath ? { filePath } : {})
    });
  }
}

async function readPersonaFiles(dir: string): Promise<Array<{ content: string; filePath: string }>> {
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch {
    // 目录不存在是常态（用户从未创建 persona），静默返回空。
    return [];
  }

  const files: Array<{ content: string; filePath: string }> = [];

  // 按文件名排序保证跨平台扫描顺序确定。
  for (const entry of entries.filter(name => name.endsWith('.md')).toSorted()) {
    const filePath = path.join(dir, entry);

    try {
      files.push({ content: await fs.readFile(filePath, 'utf8'), filePath });
    } catch {
      // 单文件读取失败（权限/竞态删除）不阻塞其余 persona 加载。
    }
  }

  return files;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
