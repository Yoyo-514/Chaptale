import { createHash } from 'node:crypto';

import { buildMemoryInjectionBlock } from './injection-block';
import { MemoryService } from './service';

/**
 * memory 注入器：读取记忆节 → 组装注入块 → 按会话去重。
 *
 * 缓存策略（主人拍板的定案）：注入块挂 user message 前缀而非 systemPrompt；
 * 且内容未变化的轮次不重复注入——历史消息前缀保持稳定，provider prompt cache
 * 不因记忆数据变动而失效，同时避免每轮重复烧 token。
 */
export class MemoryInjector {
  private readonly lastInjectedHash = new Map<string, string>();

  constructor(private readonly memoryService: MemoryService) {}

  /** 返回本轮应注入的信封（含尾随空行分隔）；无内容或与上次相同时返回空串。 */
  async resolvePrefix(sessionId: string, cwd: string): Promise<string> {
    let block: string | undefined;

    try {
      const sections = await this.memoryService.readSections(cwd);
      block = buildMemoryInjectionBlock(sections);
    } catch {
      // 记忆读取失败绝不阻塞对话主流程；下一轮自然重试。
      return '';
    }

    if (!block) {
      return '';
    }

    const hash = createHash('sha1').update(block).digest('hex');

    if (this.lastInjectedHash.get(sessionId) === hash) {
      return '';
    }

    this.lastInjectedHash.set(sessionId, hash);
    return `${block}\n\n`;
  }

  /** 会话缓存失效（工作区切换等）时同步清空注入记录。 */
  reset() {
    this.lastInjectedHash.clear();
  }
}

export function createMemoryInjector(chaptaleRootDir: string): MemoryInjector {
  return new MemoryInjector(new MemoryService({ chaptaleRootDir }));
}
