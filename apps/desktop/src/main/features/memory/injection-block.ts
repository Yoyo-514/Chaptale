import { estimateTextTokens } from '../../core/context/token-counter';
import type { MemorySections } from './service';

/** 注入块总预算（tokens）；估算走 core/context 的共用口径，非 ASCII 一字符一 token。 */
const DEFAULT_BUDGET_TOKENS = 2000;

type SectionSpec = {
  key: keyof MemorySections;
  title: string;
  /** 超预算被整节截断时的替代提示（指引 agent 用 read 深挖）。 */
  truncationHint: string;
};

/**
 * 注入优先级：守则 > 伏笔 > 偏好 > 资产目录 > 近况 > notes。
 * 超限规则：低优先级整节截断并附一行提示，不做节内裁剪（保持内容完整可信）。
 */
const SECTION_PRIORITY: SectionSpec[] = [
  {
    key: 'styleGuide',
    title: '创作守则与禁忌',
    truncationHint: '创作守则未注入，需要时按 chaptale.json 的 world 目录定位创作守则'
  },
  { key: 'threads', title: '活跃伏笔', truncationHint: '活跃伏笔未注入，需要时用 memory_search 检索' },
  {
    key: 'preferences',
    title: '作者偏好要点',
    truncationHint: '作者偏好未注入，需要时用 read 查看 ~/.chaptale/memory/'
  },
  {
    key: 'assets',
    title: '作品资产目录',
    truncationHint: '资产目录未注入，需要时用 memory_search 检索'
  },
  {
    key: 'recent',
    title: '最近剧情',
    truncationHint: '近况未注入，需要时用 read 查看 .chaptale/memory/summaries/recent.md'
  },
  { key: 'notes', title: '观察笔记清单', truncationHint: '笔记清单未注入，需要时用 ls 查看 .chaptale/memory/notes/' }
];

/**
 * 组装 memory 注入块（确定性纯函数：同输入必同输出）。
 *
 * 输出为挂在 user message 前缀的 XML 信封（不进 systemPrompt，保护 prompt cache）；
 * 全部节为空时返回 undefined，调用方不注入空块。
 */
export function buildMemoryInjectionBlock(
  sections: MemorySections,
  budgetTokens = DEFAULT_BUDGET_TOKENS
): string | undefined {
  const rendered: string[] = [];
  const hints: string[] = [];
  let usedTokens = 0;

  for (const spec of SECTION_PRIORITY) {
    const content = sections[spec.key]?.trim();

    if (!content) {
      continue;
    }

    const block = `## ${spec.title}\n${content}`;
    const cost = estimateTextTokens(block);

    if (usedTokens + cost > budgetTokens) {
      hints.push(`- ${spec.truncationHint}`);
      continue;
    }

    rendered.push(block);
    usedTokens += cost;
  }

  if (rendered.length === 0 && hints.length === 0) {
    return undefined;
  }

  const body = [...rendered, ...(hints.length > 0 ? [`## 未注入内容\n${hints.join('\n')}`] : [])].join('\n\n');

  // 信封说明放属性外的固定文案，内容本身不转义（Markdown 正文，非 XML 数据）。
  return `<memory summary="跨会话记忆注入，仅供参考；与作者本轮指令冲突时以指令为准">\n${body}\n</memory>`;
}
