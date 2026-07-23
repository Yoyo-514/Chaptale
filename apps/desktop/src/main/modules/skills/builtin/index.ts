import blueprintInterviewSource from './blueprint-interview.md?raw';
import namingConventionsSource from './naming-conventions.md?raw';
import reviewChecklistSource from './review-checklist.md?raw';
import rewriteMinimalDiffSource from './rewrite-minimal-diff.md?raw';
import sceneCardTemplateSource from './scene-card-template.md?raw';

export type BuiltinSkillSource = {
  /** 物化到磁盘时的文件名（pi loader 按目录扫描 .md）。 */
  fileName: string;
  source: string;
};

/** 构建期打进 bundle 的内置 skill 源文本；新增内置 skill 时在此登记。 */
export const builtinSkillSources: readonly BuiltinSkillSource[] = [
  { fileName: 'blueprint-interview.md', source: blueprintInterviewSource },
  { fileName: 'scene-card-template.md', source: sceneCardTemplateSource },
  { fileName: 'review-checklist.md', source: reviewChecklistSource },
  { fileName: 'rewrite-minimal-diff.md', source: rewriteMinimalDiffSource },
  { fileName: 'naming-conventions.md', source: namingConventionsSource }
];
