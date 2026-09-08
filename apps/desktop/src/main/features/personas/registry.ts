import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PersonaDefinition, PersonaDiagnostic, PersonaSource } from '@chaptale/shared';
import { getOutputSchema, PersonaFrontmatterValidator } from '@chaptale/shared';

import type { FrontmatterParser } from '../../core/frontmatter/types';
import { readManagedText, resolveManagedPath } from '../../infra/filesystem/managed-text';

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

    for (const { content, filePath } of await readPersonaFiles(
      path.dirname(this.options.userPersonasDir),
      path.basename(this.options.userPersonasDir),
      'user',
      diagnostics
    )) {
      this.register(byId, diagnostics, content, 'user', filePath);
    }

    for (const { content, filePath } of await readPersonaFiles(cwd, '.chaptale/personas', 'workspace', diagnostics)) {
      this.register(byId, diagnostics, content, 'workspace', filePath);
    }

    return { personas: [...byId.values()].toSorted((a, b) => a.id.localeCompare(b.id)), diagnostics };
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

    if (
      parsed.frontmatter.execution === 'task' &&
      (!parsed.frontmatter.output || !getOutputSchema(parsed.frontmatter.output))
    ) {
      diagnostics.push({ source, filePath, message: 'task 专员必须选择已注册的输出格式' });
      return;
    }

    byId.set(parsed.frontmatter.id, {
      ...parsed.frontmatter,
      ...(source !== 'builtin'
        ? {
            tools: parsed.frontmatter.tools ?? [],
            memory: parsed.frontmatter.memory ?? { read: [], write: [], propose: [] },
            delegatable: parsed.frontmatter.delegatable ?? false
          }
        : {}),
      body: parsed.body,
      source,
      ...(filePath ? { filePath } : {})
    });
  }
}

async function readPersonaFiles(
  root: string,
  relative: string,
  source: PersonaSource,
  diagnostics: PersonaDiagnostic[]
): Promise<Array<{ content: string; filePath: string }>> {
  let entries;

  try {
    entries = await fs.readdir(await resolveManagedPath(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push({ source, message: toMessage(error) });
    return [];
  }

  const files: Array<{ content: string; filePath: string }> = [];

  // 按文件名排序保证跨平台扫描顺序确定。
  if (entries.length > 300) diagnostics.push({ source, message: '专员目录超过 300 项，超出部分未读取' });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name)).slice(0, 300)) {
    if (!entry.name.endsWith('.md')) continue;
    const filePath = path.join(root, relative, entry.name);

    try {
      files.push({ content: await readManagedText(root, `${relative}/${entry.name}`), filePath });
    } catch (error) {
      diagnostics.push({ source, filePath, message: toMessage(error) });
    }
  }

  return files;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
