export type SkillScope = 'global' | 'work';

export interface SkillDiagnosticView {
  type: 'warning' | 'error' | 'collision';
  message: string;
  path: string;
}

export interface ManagedSkillView {
  name: string;
  description: string;
  scope: SkillScope;
  enabled: boolean;
  disableModelInvocation: boolean;
  filePath: string;
  baseDir: string;
  /** 全局技能被当前作品的同名技能接管时为 true。 */
  overriddenByWork?: boolean;
}

export interface ManagedSkillsSnapshot {
  globalDir: string;
  workDir: string | null;
  skills: ManagedSkillView[];
  diagnostics: SkillDiagnosticView[];
}

export interface SessionSkillItem {
  name: string;
  description: string;
  scope: SkillScope;
  disableModelInvocation: boolean;
}

export interface SkillInvocationView {
  name: string;
}
