import { createHash } from 'node:crypto';

import {
  CONTENT_TOOLS,
  PersonaFrontmatterValidator,
  TemplateHeaderValidator,
  getOutputSchema,
  reviewerOption,
  type ContentKind,
  type PersonaFrontmatter
} from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { parseSkillFile } from '../../core/agent/skills';
import { MAX_MANAGED_TEXT_BYTES } from '../../infra/filesystem/managed-text';

export const contentHash = (text: string) => createHash('sha256').update(text).digest('hex');
const protectedFields = new Set([
  'id',
  'kind',
  'template',
  'templateId',
  'templateHash',
  '__proto__',
  'prototype',
  'constructor'
]);

export function describeContent(
  kind: ContentKind,
  markdown: string
): { id: string; name: string; persona?: PersonaFrontmatter; targetKind?: string } {
  if (!markdown.isWellFormed() || markdown.includes('\0') || Buffer.byteLength(markdown) > MAX_MANAGED_TEXT_BYTES)
    throw new Error('内容必须是 128 KiB 以内的 UTF-8 文本');
  const head = parseDocumentFrontmatter(markdown);
  if (head.status !== 'ok' || !head.body.trim()) throw new Error('内容需要有效元数据和非空正文');
  if (kind === 'persona') {
    if (!PersonaFrontmatterValidator.Check(head.frontmatter)) throw new Error('专员元数据无效');
    const persona = head.frontmatter;
    if (persona.execution === 'task' && (!persona.output || !getOutputSchema(persona.output)))
      throw new Error('任务专员必须使用已注册的输出格式');
    if (persona.type === 'review' && !reviewerOption({ ...persona, enabled: true }))
      throw new Error('审查专员必须使用审查输出格式');
    if (persona.tools?.some(name => !CONTENT_TOOLS.some(tool => tool.id === name)))
      throw new Error('专员包含未注册工具');
    return { id: persona.id, name: persona.name, persona };
  }
  if (kind === 'skill') {
    const skill = parseSkillFile(markdown);
    if (!skill || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || skill.name.length > 64 || !skill.description.trim())
      throw new Error('技能需要有效名称与描述');
    if (skill.description.length > 1000 || skill.appliesTo.length > 100) throw new Error('技能元数据过长');
    return { id: skill.name, name: skill.description };
  }
  if (!TemplateHeaderValidator.Check(head.frontmatter)) throw new Error('模板元数据无效');
  const template = head.frontmatter;
  if (
    new Set(template.fields.map(field => field.key)).size !== template.fields.length ||
    template.fields.some(field => protectedFields.has(field.key))
  )
    throw new Error('模板字段重复或包含受保护字段');
  return { id: template.template, name: template.name, targetKind: template.targetKind };
}

/** 分享的是内容，不是本机授权；正文完整保留供作者检查，不声称能自动识别秘密。 */
export function portableContent(kind: ContentKind, markdown: string) {
  const described = describeContent(kind, markdown);
  const head = parseDocumentFrontmatter(markdown);
  if (head.status !== 'ok') throw new Error('内容格式错误');
  if (kind === 'persona') {
    const { model: _model, ...persona } = described.persona!;
    return {
      markdown: patchDocumentFields(head.body, {
        ...persona,
        tools: [],
        memory: { read: [], write: [], propose: [] },
        delegatable: false,
        enabled: false
      }),
      warnings: ['不携带模型偏好、工具和记忆授权；导入后专员为停用状态。']
    };
  }
  if (kind === 'skill') {
    const skill = parseSkillFile(markdown)!;
    return { markdown: patchDocumentFields(head.body, skill), warnings: [] };
  }
  return { markdown, warnings: [] };
}
