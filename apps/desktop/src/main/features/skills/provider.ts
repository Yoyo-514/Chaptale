export type SkillDescriptor = {
  name: string;
  description: string;
};

export type SkillLoadResult = {
  skills: SkillDescriptor[];
};

/** Skill 发现与磁盘加载的应用层端口；隐藏 Pi loader 约定，调用方不直接依赖 Pi。 */
export interface SkillProvider {
  /** personaId 缺省时不做 appliesTo 过滤（列全量，供 Slash 菜单等场景）。 */
  load(cwd: string, personaId?: string): SkillLoadResult;
}
