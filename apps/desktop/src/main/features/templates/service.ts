import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';

import { CreateAssetValidator, type CreateAssetArgs } from '@chaptale/ipc-contract';
import {
  TemplateHeaderValidator,
  templateDefaults,
  validateTemplateValues,
  type AssetTemplate,
  type TemplateList
} from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { readDocumentSnapshot } from '../workspace/read-document';
import type { WorkspaceService } from '../workspace/service';
import { builtinTemplates } from './builtin';

const protectedKeys = new Set([
  'id',
  'kind',
  'template',
  'templateId',
  'templateHash',
  '__proto__',
  'prototype',
  'constructor'
]);
export class TemplateService {
  constructor(
    private readonly workspace: Pick<WorkspaceService, 'getState' | 'createDocument'>,
    private readonly userDirectory: string
  ) {}
  private async assertWorkspace(rootPath: string) {
    if ((await this.workspace.getState()).rootPath !== rootPath) throw new Error('工作区已切换');
  }
  async list(rootPath: string): Promise<TemplateList> {
    await this.assertWorkspace(rootPath);
    const templates = new Map<string, AssetTemplate>();
    const diagnostics: string[] = [];
    let scanned = 0;
    const add = (content: string, source: AssetTemplate['source'], sourcePath: string) => {
      const head = parseDocumentFrontmatter(content);
      if (head.status !== 'ok' || !TemplateHeaderValidator.Check(head.frontmatter)) {
        diagnostics.push(`${sourcePath}: 模板定义不合法`);
        return;
      }
      const fields = head.frontmatter.fields;
      if (
        new Set(fields.map(field => field.key)).size !== fields.length ||
        fields.some(field => protectedKeys.has(field.key))
      ) {
        diagnostics.push(`${sourcePath}: 模板字段重复或包含受保护字段`);
        return;
      }
      templates.set(head.frontmatter.template, {
        ...head.frontmatter,
        body: head.body,
        hash: createHash('sha256').update(content).digest('hex'),
        source,
        sourcePath
      });
    };
    for (const [index, content] of builtinTemplates.entries()) add(content, 'builtin', `builtin:${index}`);
    const scan = async (directory: string, relative: string, source: 'user' | 'workspace', depth = 0) => {
      if (depth > 4) {
        diagnostics.push(`${relative}: 模板目录超过 4 层`);
        return;
      }
      let entries;
      try {
        entries = await readdir(await resolveWithinCwd(directory, relative || '.'), { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`${relative}: ${String(error)}`);
        return;
      }
      for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
        if (++scanned > 1000) {
          diagnostics.push('模板扫描超过 1000 项，请缩小模板目录');
          return;
        }
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
        const sourcePath = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await scan(directory, sourcePath, source, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.md')) {
          try {
            const document = await readDocumentSnapshot({
              rootPath: directory,
              relativePath: sourcePath,
              maxBytes: 128 * 1024
            });
            add(document.content, source, sourcePath);
          } catch (error) {
            diagnostics.push(`${sourcePath}: ${String(error)}`);
          }
        }
      }
    };
    await scan(this.userDirectory, '', 'user');
    const layout = await new WorkspaceLayoutService().read(rootPath);
    await scan(rootPath, layout.roles.templates.relativePath, 'workspace');
    await this.assertWorkspace(rootPath);
    return { templates: [...templates.values()].toSorted((a, b) => a.template.localeCompare(b.template)), diagnostics };
  }
  async create(args: CreateAssetArgs) {
    if (!CreateAssetValidator.Check([args])) throw new Error('模板创建请求不合法');
    const template = (await this.list(args.rootPath)).templates.find(value => value.template === args.templateId);
    if (!template || template.hash !== args.templateHash) throw new Error('模板已变化，请重新选择');
    const values = { ...templateDefaults(template), ...args.values };
    const errors = validateTemplateValues(template, values);
    if (errors.length) throw new Error(errors.join('\n'));
    const layout = await new WorkspaceLayoutService().read(args.rootPath);
    const directory =
      args.directory ??
      `${layout.roles[template.targetRole].relativePath}${template.template === 'scene-card' ? '/场景卡' : ''}`;
    if (!args.filename.endsWith('.md')) throw new Error('资产文件名必须以 .md 结尾');
    const body = template.body.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_-]*)\}\}/g, (_match, key: string) =>
      String(values[key] ?? '')
    );
    const content = patchDocumentFields(body, {
      id: randomUUID(),
      kind: template.targetKind,
      templateId: template.template,
      templateHash: template.hash,
      ...values
    });
    const result = await this.workspace.createDocument({
      rootPath: args.rootPath,
      relativePath: `${directory}/${args.filename}`,
      content
    });
    if (!result.ok) throw new Error(result.message);
    return result.document;
  }
}
