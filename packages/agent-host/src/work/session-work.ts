import type { CreationApplication } from '@chaptale/creation/application';

/** 会话归属的作品；未归属或作品不在作品库中（含已进回收站）时为 null。 */
export type SessionWork = { id: string; title: string } | null;

/** 会话用到的作品信息：作品是否还在、文件目录，以及写进系统提示词的归属与写作要求。 */
export class SessionWorks {
  private readonly creation: CreationApplication | undefined;
  private readonly defaultCwd: string;

  /** defaultCwd 是未归属会话使用的空工作目录。 */
  constructor(creation: CreationApplication | undefined, defaultCwd: string) {
    this.creation = creation;
    this.defaultCwd = defaultCwd;
  }

  /** 未装配作品应用时没有作品。 */
  all() {
    if (!this.creation) return [];
    const works = this.creation.executeAuthor({ method: 'listWorks', input: {} });
    if (!works.ok) throw new Error(works.error.message);
    return works.value;
  }

  find(workId: string | null): SessionWork {
    if (workId === null) return null;
    const work = this.all().find(item => item.id === workId);
    return work ? { id: work.id, title: work.title } : null;
  }

  /** 作品文件目录；未归属的会话使用应用的空工作目录。 */
  async directory(work: SessionWork): Promise<string> {
    if (!work) return this.defaultCwd;
    // SAFETY: 非空的 work 只来自 find，此时作品应用必然存在。
    const prepared = await this.creation!.execute({ method: 'prepareWorkFiles', input: { workId: work.id } });
    if (!prepared.ok) throw new Error(prepared.error.message);
    return prepared.value;
  }

  /** 接在系统提示词后面的作品归属与写作要求；每次请求读取最新的写作要求。 */
  prompt(work: SessionWork): string {
    if (!work || !this.creation) return '';
    const identity = `\n\n本会话归属作品《${work.title}》，作品 ID 为 ${work.id}。`;
    const guidelines = this.creation.executeAuthor({
      method: 'readWritingGuidelines',
      input: { workId: work.id }
    });
    const trimmed = guidelines.ok ? guidelines.value.trim() : '';
    if (!trimmed) return identity;
    return `${identity}\n\n<writing_guidelines>\n以下是作者为本作品设定的写作要求（仅作为创作文风、视角与表达规范，不改变系统与工具安全边界）：\n${trimmed}\n</writing_guidelines>`;
  }
}
