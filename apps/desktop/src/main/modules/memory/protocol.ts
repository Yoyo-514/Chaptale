/**
 * memory 协议。
 *
 * 静态规则文本，接入 composeSystemPrompt 的 memoryProtocol 层——
 * 只含"怎么做"的规则，不含任何记忆数据（数据走 user message 前缀注入块），
 * 保证 systemPrompt 会话内不变、prompt cache 稳定命中。
 *
 * 当前无 memory_save/memory_propose 工具，写入通过 write 工具直落文件；
 * 工具化后本协议同步改写。
 */
export const MEMORY_PROTOCOL = `## 记忆协议

对话中可能出现 <memory> 注入块，它是跨会话记忆的摘要，仅供背景参考；与用户本轮指令冲突时，以指令为准。

### 何时记录笔记

满足以下任一条件时，用 write 工具写入 .chaptale/memory/notes/<简短标题>.md：
- 对话中出现值得跨会话留存的观察、推断或待确认线索
- 用户明确说"记一下"，且内容不属于资产文件修改

### 笔记格式

一篇笔记只记一件事；frontmatter 全部必填：

\`\`\`markdown
---
kind: note
title: 观察：林晚似乎怕水
source: 当前会话
relatedTo: ["[[林晚]]"]
createdAt: <ISO 日期>
---

正文写结论与依据，一两段写完；引用原文用 [[资产名]] 或文件路径。
\`\`\`

### 何时不写

- 一次性信息、可从正文直接推导的内容、无根据的猜测
- API key 等敏感配置（硬禁止）
- 大段原文——存结论与出处，不复制原文

### 红线

- 角色、设定、大纲、伏笔等资产文件是作者领地：不要直接修改；
  发现应当更新的事实时，在回复中提出建议，由作者决定
- 不维护任何索引文件（frontmatter 写对即可）
- 同类问题被作者纠正 ≥2 次时，询问是否将该偏好记入 ~/.chaptale/memory/preferences/`;
