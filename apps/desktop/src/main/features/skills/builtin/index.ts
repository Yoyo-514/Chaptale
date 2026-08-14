import blueprintInterviewSource from './blueprint-interview.md?raw';
import namingConventionsSource from './naming-conventions.md?raw';
import reviewChecklistSource from './review-checklist.md?raw';
import rewriteMinimalDiffSource from './rewrite-minimal-diff.md?raw';
import sceneCardTemplateSource from './scene-card-template.md?raw';

export type BuiltinSkillSource = {
  /** skill 目录名（物化为 <dir>/<name>/SKILL.md，与自有 loader 约定一致）。 */
  dirName: string;
  source: string;
};

/** 构建期打进 bundle 的内置 skill 源文本；新增内置 skill 时在此登记。换行统一为 LF，避免 Windows 检出的 CRLF 渗入运行层。 */
export const builtinSkillSources: readonly BuiltinSkillSource[] = [
  { dirName: 'blueprint-interview', source: blueprintInterviewSource.replace(/\r\n/g, '\n') },
  { dirName: 'scene-card-template', source: sceneCardTemplateSource.replace(/\r\n/g, '\n') },
  { dirName: 'review-checklist', source: reviewChecklistSource.replace(/\r\n/g, '\n') },
  { dirName: 'rewrite-minimal-diff', source: rewriteMinimalDiffSource.replace(/\r\n/g, '\n') },
  { dirName: 'naming-conventions', source: namingConventionsSource.replace(/\r\n/g, '\n') }
];
