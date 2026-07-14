# Chaptale 重构文档

> 基于 2026-07-14 对全仓（apps/desktop、apps/desktop-ui、apps/mobile*、packages/*、根工程配置）的全量扫描。
> 正文（第 1–7 章）为诊断快照，行数、路径均为扫描当日数据，**不随实施更新**；实施结果见下方「实施状态」。

---

## 实施状态（2026-07-14 收工）

A1–A6、B1–B7、C1–C6 已全部实施完毕，每项独立 commit，验收标准为 lint + typecheck + 全部单测（约 360 个）+ 双 e2e 全绿。

| 项 | 结果 | 与原计划的偏差 |
|---|---|---|
| A1/A2 | 死脚本已删；根 tsconfig references 补齐 ipc-contract | agent-core 随 B1 删除，不再引用 |
| A3–A6 | 均完成 | A5 因 B1 删包而自然消解 |
| B1 | **agent-core 已删除**；`AgentRuntime`/`AgentRunOptions` 并入 ipc-contract/agent.ts，且与 `AgentStartPayload` 用 Pick/Omit 派生；electron.vite external 列表自动派生自 package.json，无需手改 | — |
| B2 | `unescapeXmlAttribute`/`parseXmlAttributes` 下沉 shared/utils/xml，双 codec 复用；**顺带发现并修复 shared 包缺 test 脚本导致 turbo 从未跑过它的测试** | — |
| B3 | `ChaptaleSessionScope` 派生自 `ChaptaleStorageMode`；`SelectedContextFile` 别名删除，全仓改用 `ChatContextFile`（连带 `toChatContextFile`/`mergeChatContextFiles` 重命名） | — |
| B4/B5 | 新增 `main/infra/`（fs-gateway/dialog-gateway/shell-gateway）；exportHtml 落盘移入 `sessions/session-export.ts`；AbortController 生命周期移入 `agent/agent-run-manager.ts` | selectWorkspaceDir 的对话框留在 IPC 边界（经网关），未进 SettingsService——避免给纯 node 服务引入 electron 依赖破坏其测试 |
| B6 | 生产代码 `window.chaptaleDesktop` 直连清零：TitleBar 抽 `useWindowControls`，readImage→Blob 收敛到 `ChatView/utils/image-blob.ts`，cancel 走统一封装 | readImageBlob 做成无状态 util 而非 store action（避免纯展示组件依赖 Pinia）；oxlint 暂无 no-restricted-syntax，防回潮靠约定 + desktop-api.ts 注释 |
| B7 | `handleTrustedIpc` 统一 await + 归一化非 Error 抛出物；渲染层统一 `toErrorMessage` 单一出口 | 未引入结构化错误信封（code 字段）——现有错误消费全是"展示文本"，信封收益不足以抵消全 API 面改动，留作未来选项 |
| C1 | `stream()` 拆为 prepareSession/applyBranch/resolveRunContext + 通用 `AsyncMessageQueue`（含单测） | — |
| C2 | useChatController 变组合门面：chat-state + 5 个子 composable + display-message 纯函数；组件 API 面不变 | — |
| C3 | `useWebAccessSettingsState` 抽出，组件只剩模板+样式 | — |
| C4 | `SessionStorageResolver` 抽出（路径解析/目录枚举/删除安全校验），repository 不再直接 import node:fs | — |
| C5 | 组件簇统一为 ToolCallGroup > ToolCallItem > {ToolCallRequest, ToolCallResult}，共享外壳 ToolCallSection；CSS 类前缀同步 | — |
| C6 | `tools/` 死脚手架删除，白名单保留为 `agent/tool-whitelist.ts`（挪到唯一消费者旁） | mobile(-ui) 维持占位不动（真正开工前不补假骨架）；UnoCSS shortcuts 未做（收益不明确，留作可选项）；sandbox:true 评估未做（需真机验证 webUtils 行为） |

---

## 目录

1. [项目现状总览](#1-项目现状总览)
2. [总体健康度评价](#2-总体健康度评价)
3. [问题清单（按区域）](#3-问题清单按区域)
   - 3.1 packages/（重点）
   - 3.2 apps/desktop（Electron 主进程 + preload）
   - 3.3 apps/desktop-ui（渲染层前端）
   - 3.4 apps/mobile 与 mobile-ui
   - 3.5 根目录与工程配置
4. [目标架构与职责划分](#4-目标架构与职责划分)
5. [分阶段重构计划](#5-分阶段重构计划)
6. [不建议动的部分](#6-不建议动的部分)
7. [附录：测试现状与工具链已知坑](#7-附录测试现状与工具链已知坑)

---

## 1. 项目现状总览

### 1.1 工作区结构

pnpm monorepo（pnpm@11.10.0 + Turbo + catalog 统一版本），workspace 为 `apps/*` + `packages/*`：

```
Chaptale/
├── apps/
│   ├── desktop/        @chaptale/desktop      Electron 主进程 + preload（~55 个源文件）
│   ├── desktop-ui/     @chaptale/desktop-ui   Vue 3 渲染层（214 文件 / 16,679 行）
│   ├── mobile/         @chaptale/mobile       Capacitor 占位壳（3 个文件）
│   └── mobile-ui/      （无 package.json）     纯空壳（main.ts 仅 export {}）
├── packages/
│   ├── shared/         @chaptale/shared       领域类型 + 纯函数工具（~276 行）
│   ├── ipc-contract/   @chaptale/ipc-contract IPC 契约：channel 常量 + DTO（~544 行）
│   └── agent-core/     @chaptale/agent-core   Agent 运行时抽象（仅 66 行）
├── e2e/                渲染层 e2e ×1 + Electron 安全冒烟 ×1
├── design-docs/        设计文档（gitignore，含"勿改写"标记）
    └── outdated/           临时笔记 ×2（gitignore）
├── backup/             design-docs 的完整重复副本（gitignore）
└── guide-docs/         空目录（gitignore）
```

### 1.2 依赖关系图（实际 import 验证过）

```
                    ┌──────────────┐
                    │ desktop-ui   │──── shared, ipc-contract
                    └──────────────┘
                    ┌──────────────┐
                    │ desktop      │──── shared, ipc-contract, agent-core
                    └──────────────┘
                    ┌──────────────┐
                    │ mobile(-ui)  │──── （不依赖任何包，纯占位）
                    └──────────────┘

  packages 内部：ipc-contract ──→ shared ←── agent-core
  （单向依赖，无循环、无反向。✅）
```

关键事实：

- `agent-core` 全仓只有 **1 个消费者**（`apps/desktop/src/main/services/pi-agent.service.ts`），且只用了 2 个符号（`AgentRuntime`、`AgentRunOptions`）。
- 三个包的 exports 策略一致：类型走 `dist/index.d.ts`、运行时直接吃 `src/index.ts` 源码（由 electron-vite/vitest 转译）。
- Agent 能力底座是 `@earendil-works/pi-ai` / `pi-coding-agent`（pi SDK），主进程通过 `agent/` 目录的三个 mapper/factory 隔离 SDK 细节。

---

## 2. 总体健康度评价

先说结论：**这个项目的底子比"目录结构乱"的直觉要好很多**。真正乱的不是宏观分层，而是几处局部：包职责重叠、个别巨型文件、约定不统一。

| 区域 | 健康度 | 一句话诊断 |
|---|---|---|
| `packages/shared` | ★★★★★ | 纯类型 + 纯函数，无越界，唯一有单测的包，可作为干净基线 |
| `packages/ipc-contract` | ★★★★☆ | 纯契约无实现逻辑，但与 agent-core 存在三组重复类型 |
| `packages/agent-core` | ★★☆☆☆ | **问题最大**：66 行里约 40 行死代码，"跨端复用"从未落地，制造了第二套 Agent 类型 |
| `apps/desktop` 主进程 | ★★★★☆ | 分层清晰（IPC 薄层→Service）、零裸 channel、安全网关集中；问题是巨型方法、fs/dialog 无统一封装、一处逐字重复 |
| `apps/desktop-ui` | ★★★★☆ | feature-first 组织、无死代码、无类型重复、生产无 mock；问题是 IPC 走向约定不统一、3 个巨型文件、工具消息组件簇命名混乱 |
| `apps/mobile(-ui)` | 占位 | 空壳，无代码可评，但拖着失效脚本和不完整的 workspace 配置 |
| 根工程配置 | ★★★☆☆ | turbo/vitest/playwright 组织合理，但 tsconfig references 有遗漏、存在指向不存在包的死脚本、杂项目录冗余 |

**全仓没有超过 520 行的源码文件、没有裸字符串 IPC channel、没有生产代码里的 mock。** 重构的主战场是"收敛与统一"，不是"推倒重来"。

---

## 3. 问题清单（按区域）

严重度标记：🔴 应尽快处理 / 🟡 建议处理 / 🟢 可选优化

### 3.1 packages/（重点）

#### P1 🔴 agent-core 是"过早抽象"的空壳包，约 60% 是死代码

- 全仓 grep 确认零消费的导出：
  - `packages/agent-core/src/errors.ts` 整个文件（`AgentRuntimeError`）
  - `packages/agent-core/src/events.ts` 整个文件（`AgentRunId`、`AgentRunMessageEvent`、`AgentRunDoneEvent`、`AgentRunErrorEvent`、`AgentRunEvent`、`AgentStreamHandlers` 共 6 个类型）
  - `packages/agent-core/src/runtime.ts` 中的 `AgentRunResult`、`CancellableAgentRuntime`
- 真正被使用的只有 `AgentRuntime` 接口 + `AgentRunOptions`，消费者仅 `pi-agent.service.ts:1` 一处。
- 该包的存在理由是"移动端未来复用"，但 `apps/mobile` 对它 **0 引用**，且 mobile 本身是空壳。
- barrel（`index.ts`）显式列名导出了全部死代码符号，掩盖了"没人用"的事实。

#### P2 🔴 agent-core 与 ipc-contract 的三组跨包类型重复

| 概念 | agent-core | ipc-contract | 问题 |
|---|---|---|---|
| 运行结果 | `AgentRunResult`（runtime.ts:15，含 status/error） | `AgentRunResult`（agent.ts:17，仅 runId） | **同名不同形**，极易 import 错；preload 实际用的是 ipc-contract 版（`preload/index.ts:10`） |
| 流式回调 | `AgentStreamHandlers`（events.ts） | `StreamAgentHandlers`（agent.ts:39） | 结构几乎相同（onMessage/onDone/onError），命名词序还相反 |
| 运行入参 | `AgentRunOptions`（query/sessionId/signal/…） | `AgentStartPayload` + `StreamAgentOptions` | 同一批业务字段两包各写一遍，仅 signal vs runId 之差 |

#### P3 🟡 `'global' | 'workspace'` union 三处重复定义

- `ipc-contract/src/settings.ts:1` → `ChaptaleStorageMode`
- `ipc-contract/src/session.ts:81` → `ChaptaleSessionScope`（同一 union 另起一名）
- `ipc-contract/src/session.ts:137` → `ChaptaleSessionStorageDebugInfo.storageMode` 内联字面量

#### P4 🟡 shared 缺 XML 反向函数，导致主进程两处逐字重复（详见 D2）

`shared/utils/xml.ts` 只有编码方向（`escapeXmlAttribute`/`escapeXmlText`），没有对应的 unescape/parse，于是主进程两个 codec 各自复制了一份解码实现。

#### P5 🟢 包间工程配置不一致

- `agent-core/tsconfig.json` 显式写了 `paths: { "@chaptale/shared": [...] }`，而功能相同的 `ipc-contract/tsconfig.json` 只靠 `references` + workspace 链接解析。两包应统一为一种风格。
- `agent-core`、`ipc-contract` 的 package.json 没有 `test` 脚本；vitest 根配置的 coverage 显式排除了它们（ipc-contract 是纯类型可接受，agent-core 若保留则应有测试）。

#### P6 🟢 轻微命名冗余

- `ipc-contract/src/agent.ts:3` 的 `SelectedContextFile = ChatContextFile` 是纯别名转发，无新增语义。
- shared 的 `escapeXml*` 语义偏"主进程 prompt 拼装"而非通用工具，位置轻微存疑（补齐反向函数后可接受，见 D2）。

### 3.2 apps/desktop（Electron 主进程 + preload）

先记录做得好的（重构时保持）：按域拆分的 7 个 IPC 薄文件、零裸字符串 channel、`handleTrustedIpc` 集中安全网关、preload 单命名空间 `chaptaleDesktop` 严格实现 `ChaptaleDesktopApi`、`agent/` 目录集中隔离 pi SDK。

#### D1 🔴 `pi-agent.service.ts` 的 `stream()` 巨型方法（约 150 行，L69–222）

单个方法混合了：模型同步、上下文文件解析、图片 presentation、pi 回调→`AsyncGenerator<ChatMessage>` 桥接、分支复用、abort 处理。这是全后端圈复杂度最高的单点，也是后续加功能时最容易改坏的地方。

#### D2 🔴 两处逐字重复的 XML 属性解码逻辑

- `services/context-files/context-message-codec.ts:5-24` 与 `services/skills/skill-message-codec.ts:4-23` 逐字重复了 `ATTRIBUTE_PATTERN` + `decodeXmlAttribute` + `parseAttributes` 三段。
- 编码方向已在 `shared/utils/xml.ts`，解码方向应下沉到同一文件（对应 P4）。

#### D3 🟡 `session.repository.ts`（274 行）职责偏多

CRUD + 分支/leaf + 导出 HTML + 图片读取 + 存储目录解析 + 删除安全校验挤在一个类里。是全仓最大的非测试后端文件。

#### D4 🟡 业务逻辑泄漏到 IPC 层（3 处）

- `ipc/session.ipc.ts:40-57` `exportHtml`：handler 里直接 `dialog.showSaveDialog` + `fs.writeFile` 落盘。
- `ipc/settings.ipc.ts:29-55` `selectWorkspaceDir`：handler 里编排 openDialog + 结果判断 + `settingsService.update`。
- `ipc/agent.ipc.ts`：handler 里维护 `controllers: Map<runId, AbortController>` 运行时状态——传输适配放这里尚可，但 abort 生命周期属于运行时状态管理，可上移。

#### D5 🟡 fs / dialog / shell 无统一封装

- `node:fs/promises` 直接 import 散落在约 8 个源码文件（session.repository、settings.service、context-file.service、image-attachment.service、prompt-file.service、pi-agent-session.factory、json-file、session.ipc）。
- `dialog.showXxx` 3 处（session.ipc、settings.ipc、context-file.service）、`shell.openPath/openExternal` 3 处，各自裸调。
- 已有的封装互相不知道对方存在：`settings/json-file.ts`（JSON 原子写）只被 settings.service 用；`prompt-file.service.ts` 又自己实现了一套文本版 `readOptionalTextFile/writeOptionalPromptFile`，思路重复。
- 后果：单测必须逐个 mock `node:fs`，且原子写/容错策略无法统一演进。

#### D6 🟢 `tools/` 是零调用的预留骨架

`tools/tool-registry.ts:12` 的 `chaptaleTools = []` 恒为空数组，`getPiCustomTools()` 恒返回 `[]`，`core/chaptale-tool.ts` + `pi/pi-tool-adapter.ts` 当前无任何使用者（注释说明联网能力已改由 pi-web-access 提供）。

#### D7 🟢 其他小项

- `prompt/default-system-prompt.ts:4` 的 `PERSONA_SYSTEM_PROMPT` 与 `DEFAULT_SYSTEM_PROMPT` 同值别名，冗余。
- `main/index.ts:43` `sandbox: false`（为 preload 使用 `webUtils` 而关闭）——可评估恢复 `sandbox: true` 的可行性（Electron 的 `webUtils.getPathForFile` 在 sandboxed preload 中可用性需验证）。

### 3.3 apps/desktop-ui（渲染层）

先记录做得好的：`components/` 全部 `App*` 前缀设计系统组件（族目录 + types + constants + barrel + tests 规范一致）、modules feature-first、settings store 的"聚合 + 分域 action 文件"拆法是全仓范本、无死代码、无与 packages 重复的类型、生产代码零 mock/TODO。

#### U1 🔴 IPC 调用走向没有统一约定

- `session/settings/models` 域走 store（`stores/utils/desktop-api.ts` 的 `getDesktopApi()` 封装）；
- 但 `agent 流式、slashCommands、contextFiles` 域没有任何 store 层，由 `useChatController.ts` 直连 `getDesktopApi().agent.stream(...)`。
- 另有 **4 处生产代码绕过封装直接 `window.chaptaleDesktop?.xxx`**：
  - `modules/TitleBar/TitleBar.vue:4,8,13,17,22`（windowControl 全套；用可选链判断桌面端，属半有意为之）
  - `modules/AgentPanel/ChatView/composables/useChatController.ts:376`（`agent.cancel`）
  - `modules/AgentPanel/ChatView/components/ChatInput/ChatContextFiles.vue:42`（`session.readImage`）
  - `modules/AgentPanel/ChatView/components/message/UserMessage.vue:54`（`session.readImage`）

#### U2 🔴 `useChatController.ts`（501 行）单 composable 管七件事

消息加载/分支、流式回调、发送/取消、编辑/重生成、上下文文件拖拽、Web 搜索开关、slash 命令，全在一个 composable。方向是对的（逻辑没堆在组件里），但已是全仓最大源码文件。

#### U3 🟡 `WebAccessSettings.vue`（414 行）逻辑全留在组件

对照同模块的 LLMSettings 已有 `useLlmSettingsState` composable 的做法，WebAccess 没有对应 composable，模板 + 逻辑 + 49 行样式混在一个 section 组件里，是全仓最大 `.vue`。

#### U4 🟡 工具消息组件簇命名重叠、概念不清

围绕"工具调用展示"有 5 个组件：`ToolCallMessage`、`ToolResultMessage`、`ToolExecutionItem`(194 行)、`ToolMessageGroup`(194 行)、`ToolMessageSection`(79/56 行)。均被引用（非死代码），但 Group/Section/Item/Call/Result 的层级语义无法从名字推断，是前端最需要"厘清概念再重命名"的一块。

#### U5 🟢 scoped 样式偏胖，UnoCSS 原子化优势未发挥

- 范式统一（scoped SCSS + `@apply` + CSS 变量），但 `@apply` 全仓 494 次/79 文件，`.vue` 内 `<style>` 合计约 3,004 行。
- 偏大样式块：`AppButton.vue` 124 行、`HistorySessionItem.vue` 121、`SettingsPanel.vue` 105、`AppImageLightbox.vue` 98 等。
- 重复的 `@apply` 组合可抽为 UnoCSS shortcuts。

#### U6 🟢 其他小项

- `MessageItem.vue`（284 行）是消息分发器，import 8 个子消息组件，接近拆分派逻辑的临界点，暂可观察。
- 路由级视图命名为模块内 `index.vue` 而非 `views/` 目录——是刻意约定，不算问题，但应写进项目文档避免新人困惑。

### 3.4 apps/mobile 与 mobile-ui

#### M1 🟡 mobile-ui 连 package.json 都没有，是"半个 workspace 成员"

- `apps/mobile-ui/src/main.ts` 内容只有 `export {}`；无 vite.config、无 tsconfig。
- `apps/mobile/capacitor.config.ts` 的 `webDir: '../mobile-ui'` 指向的是这个空壳。
- 它匹配 `apps/*` workspace glob 却不是合法包，属于目录结构里最"名不副实"的部分。
- 决策点：要么给它补齐最小骨架（package.json + vite + tsconfig），要么整体挪出 `apps/`（如 `experiments/`）直到真正开工。

### 3.5 根目录与工程配置

#### R1 🔴 根 package.json 有指向不存在包的死脚本

`dev:app`、`build:app`、`typecheck:app`、`preview:app` 全部 `--filter @chaptale/app`，但仓库不存在该包（推测是 desktop 改名前的遗留）。

#### R2 🟡 根 tsconfig.json 的 references 不完整

只引用了 `packages/shared`、`apps/desktop-ui`、`apps/desktop`，**遗漏 `agent-core` 和 `ipc-contract`**（mobile 空壳可以不引）。后果：编辑器级 project-wide 检查和 `tsc -b` 不会覆盖这两个包。

#### R3 🟡 测试盲区

| 包 | 测试数 | 状态 |
|---|---|---|
| apps/desktop | 28 | ✅ 密集 |
| apps/desktop-ui | 50 | ✅ 密集 |
| packages/shared | 1 | ⚠️ 仅 utils 一个测试文件（好在覆盖了全部 utils 导出） |
| packages/ipc-contract | 0 | 可接受（纯类型，tsc 即校验） |
| packages/agent-core | 0 | ⚠️ 且被 coverage 显式排除 |
| e2e | 2 | 渲染层 1 + Electron 安全冒烟 1 |

#### R4 🟢 杂项目录冗余（均已 gitignore、0 个 tracked 文件，清理无版本库风险）

- `backup/design-docs/` 是 `design-docs/` 的完整重复副本 → 冗余
- `temp/` 两篇临时笔记 → 可归档进 design-docs 或删除
- `guide-docs/` 空目录 → 删除或启用
- `.spec-workflow/` 的 specs/steering 均为空，只初始化了模板

> `design-docs/` 内含 `NOTE_DONT_REWRITE_OR_EDIT` 标记，**清理动作不应触碰该目录内容**。

---

## 4. 目标架构与职责划分

### 4.1 包职责的目标定义（一句话边界）

| 包 | 职责边界 | 允许依赖 | 禁止出现 |
|---|---|---|---|
| `@chaptale/shared` | 跨进程/跨端的**领域类型**（ChatMessage 族）与**无副作用纯函数**（含 XML 编 + 解码全套） | 无 | Node/Electron/Vue API、IPC 概念、业务流程 |
| `@chaptale/ipc-contract` | 桌面端 main ↔ renderer 的**唯一契约**：channel 常量 + 全部 payload/result DTO + `ChaptaleDesktopApi`；**Agent 相关 DTO 的唯一来源** | shared | 实现逻辑、运行时代码（`IPC_CHANNELS` 常量表除外） |
| `@chaptale/agent-core` | **建议撤销**（见 5.2 阶段 B1）。若保留：仅 `AgentRuntime` 接口 + 其直接入参类型，且必须有消费者与测试 | shared | 与 ipc-contract 重复的 DTO |

### 4.2 主进程分层的目标定义

```
main/index.ts          组合根：new 全部服务、注册 IPC、创建窗口（保持现状）
main/ipc/*.ipc.ts      纯绑定层：channel → service 方法，零业务逻辑（当前 3 处泄漏需归位）
main/services/*        业务服务：只依赖注入进来的 gateway，不裸调 fs/dialog
main/infra/            【新增】平台网关层：
  ├── fs-gateway.ts        统一 readJson/writeJsonAtomic/readOptionalText/writeText/…
  ├── dialog-gateway.ts    showSaveDialog/showOpenDialog 封装
  └── shell-gateway.ts     openPath/openExternal 封装
main/agent|sessions|models|settings/   领域映射层（保持现状，已经很干净）
main/security/         安全网关（保持现状）
```

### 4.3 渲染层 IPC 走向的统一约定（二选一，建议前者）

- **约定 A（推荐）**：所有 IPC 一律经 store（或 store 同级的 service 模块）暴露给组件/composable；组件永远不见 `window.chaptaleDesktop`。为 agent 流式新增 `stores/agent.ts`（或 `modules/AgentPanel/services/agent-ipc.ts`），TitleBar 的 windowControl 收进一个极小的 `useWindowControls` composable。
- 约定 B：允许 composable 直连 `getDesktopApi()`，但禁止组件直连——那也必须修掉 U1 列出的 3 处组件直连点。

关键不是选哪个，而是**写死一个约定并让 4 处例外归零**。

---

## 5. 分阶段重构计划

原则（Fowler）：小步、每步可验证、行为不变。每完成一项跑 `pnpm check`（lint + typecheck + test:unit），阶段收尾跑 `pnpm test:e2e`。当前测试基础（desktop 28 + desktop-ui 50 + e2e 2）足以支撑 A、B 两阶段；C 阶段个别项需先补测试。

### 阶段 A：零风险快赢（预计半天，纯删除/配置，不改运行时行为）

| # | 动作 | 对应问题 | 验证 |
|---|---|---|---|
| A1 | 删除根 package.json 里 4 个 `@chaptale/app` 死脚本 | R1 | `pnpm build`、`pnpm dev` 正常 |
| A2 | 根 tsconfig.json references 补上 `packages/ipc-contract`、`packages/agent-core`（若 B1 决定删包则跳过后者） | R2 | `tsc -b` 通过 |
| A3 | 删除 `agent-core/src/errors.ts`、`events.ts`，及 `runtime.ts` 里的 `AgentRunResult`、`CancellableAgentRuntime`；同步收窄 barrel | P1 | typecheck 全绿（本就零消费者） |
| A4 | 删除 `backup/`；处置 `temp/`（有价值内容归档，其余删）；删除空 `guide-docs/`。**不触碰 `design-docs/`** | R4 | 无（gitignored，0 tracked 文件） |
| A5 | 统一 `agent-core` 与 `ipc-contract` 的 tsconfig 风格（二选一：都用 paths 或都只用 references） | P5 | typecheck |
| A6 | 删除 `PERSONA_SYSTEM_PROMPT` 同值别名，统一用 `DEFAULT_SYSTEM_PROMPT` | D7 | desktop 单测 |

### 阶段 B：结构收敛（预计 2–3 天，中风险，每项独立成 commit）

**B1 🔴 收敛 Agent 类型到单一来源（本次重构最重要的一项）**

1. 决策：`agent-core` 整包撤销，`AgentRuntime` + `AgentRunOptions` 迁往 `ipc-contract/src/agent.ts`（或 desktop main 本地 `main/agent/runtime.types.ts`——若认为它是实现细节而非契约）。
   - 判断依据：该抽象当前只服务 desktop 一端；等移动端真实开工、确有第二个 runtime 实现时再抽包也不迟（YAGNI）。
2. 迁移后消除重复：`StreamAgentHandlers` 成为流式回调唯一定义；`AgentRunResult` 只剩 ipc-contract 一个定义；`AgentStartPayload`/`StreamAgentOptions` 与 `AgentRunOptions` 字段对齐、互相 `Pick`/`Omit` 派生而非重抄。
3. 更新 `pi-agent.service.ts` 的 import；从 desktop 的 package.json、pnpm-workspace、turbo、vitest coverage 排除项、根 tsconfig 中移除 agent-core。
4. 验证：typecheck 全绿 + desktop 28 个单测全绿 + `test:e2e:electron`。

**B2 🔴 XML 解码下沉 shared**

1. 在 `shared/utils/xml.ts` 新增 `unescapeXmlAttribute`（或 `decodeXmlAttribute`）+ `parseXmlAttributes`，以现有两份实现为准逐字迁移。
2. 在 `shared/utils/__tests__/utils.test.ts` 补测试（含双向 round-trip）。
3. `context-message-codec.ts` 与 `skill-message-codec.ts` 改为 import，删除各自的本地实现。
4. 验证：两个 codec 的现有单测（66 行 + 35 行）不改断言直接通过。

**B3 🟡 统一存储模式 union**

`ChaptaleStorageMode` 作为唯一定义（留在 settings.ts 或抽到 ipc-contract 公共 types 文件），`ChaptaleSessionScope = ChaptaleStorageMode` 显式别名（或直接替换），`ChaptaleSessionStorageDebugInfo.storageMode` 引用之。顺手评估删除 `SelectedContextFile` 纯别名（P6）。

**B4 🟡 主进程 IPC 层业务归位**

1. `exportHtml`：落盘逻辑（saveDialog + writeFile）下沉到 repository 或新 `session-export.service.ts`，handler 只剩转发。
2. `selectWorkspaceDir`：openDialog + 判断 + update 编排移入 `settings.service.ts` 新方法。
3. `agent.ipc.ts` 的 `AbortController Map` 移入 `pi-agent.service.ts`（或独立 `agent-run-manager.ts`），IPC 层只做 send 适配。
4. 每步验证：对应域单测 + e2e 冒烟。

**B5 🟡 新增 `main/infra/` 平台网关层**

1. 以 `settings/json-file.ts` 为种子建 `fs-gateway.ts`，合并 `prompt-file.service.ts` 的文本读写实现（消除两套原子写）。
2. 新增 `dialog-gateway.ts`、`shell-gateway.ts`，把 3 处 dialog、3 处 shell 直调收进来。
3. 服务改为构造注入 gateway（组合根 `main/index.ts` 已是手动 DI，顺势注入即可），单测从 mock `node:fs` 改为 mock gateway。
4. 建议渐进：先建 gateway 并在新代码强制使用，存量 8 个 fs 直调文件按 B6/C1 触碰到哪个迁哪个，不必一次全量。

**B6 🟡 渲染层 IPC 约定统一（对应 4.3 约定 A）**

1. 修掉 3 处组件直连：`ChatContextFiles.vue`、`UserMessage.vue` 的 `session.readImage` 走 session store 新增 action；TitleBar 抽 `useWindowControls`。
2. `useChatController.ts:376` 的 `agent.cancel` 改走统一封装。
3. 在 oxlint 加规则（`no-restricted-globals`/`no-restricted-syntax` 匹配 `window.chaptaleDesktop`，允许清单仅 `stores/utils/desktop-api.ts` 与 `types/global.d.ts`），防止回潮。

### 阶段 C：较大拆分（预计 3–5 天，较高风险，先补测试再动手）

**C1 🔴 拆 `pi-agent.service.ts#stream()`（150 行 → 编排 + 4 个协作者）**

前置：现有 279 行测试是安全网，先确认覆盖了分支复用、abort、图片、上下文文件四条路径，缺哪条补哪条。
建议拆法（Extract Method/Class，逐个提取、逐个跑测试）：

```
stream()                       只剩编排（~40 行）
├── syncModelSelection()       模型同步
├── resolveRunContext()        上下文文件 + 图片 presentation 解析
├── createEventBridge()        pi 回调 → AsyncGenerator<ChatMessage> 桥接（可独立文件）
└── （abort 处理并入 B4 的 run-manager）
```

**C2 🔴 拆 `useChatController.ts`（501 行 → 门面 + 4 个子 composable）**

前置：519 行的 use-chat-controller.test.ts 是安全网。
建议按职责切：`useChatMessages`（加载/分支/编辑/重生成）、`useChatStreaming`（发送/流式/取消）、`useChatContextFiles`（拖拽/附件）、`useChatCommands`（slash + web 搜索开关）；`useChatController` 保留为组合门面，对组件的返回面不变（外部零改动）。

**C3 🟡 `WebAccessSettings.vue` 逻辑下沉**

照抄同模块 LLMSettings 的既有模式：抽 `useWebAccessSettingsState` composable，组件只剩模板 + 样式。

**C4 🟡 拆 `session.repository.ts`（274 行）**

按读写域切：`session.repository.ts`（CRUD/分支）、`session-export.service.ts`（HTML 导出，与 B4-1 合并做）、`session-storage-resolver.ts`(目录解析/删除安全校验)。102 行现有测试跟随迁移。

**C5 🟡 工具消息组件簇重命名**

先画清层级（建议：`ToolMessageGroup`(组) > `ToolExecutionItem`(单次调用=call+result 配对) > 展示子件），再统一命名并更新引用。纯重命名 + 移动，配合组件测试验证。

**C6 🟢 可选项**

- UnoCSS shortcuts 收敛高频 `@apply` 组合（先统计 top 组合再决定，避免为抽而抽）。
- 评估 `sandbox: true` 可行性（验证 `webUtils.getPathForFile` 在 sandboxed preload 的行为）。
- `tools/` 空骨架：若半年内无自有工具计划则删除（git 历史可找回），或在 README 标注预留意图。
- mobile 决策：补齐 mobile-ui 最小骨架，或整体挪出 `apps/`。
- shared 补测（若 B2 落地，xml 测试已顺带补上；其余 utils 已覆盖）。

### 5.1 执行顺序与依赖关系

```
A1–A6（并行，互不依赖）
   ↓
B1（Agent 类型收敛）──→ C1（依赖 B1 确定的类型归属）
B2（XML 下沉）        独立
B3（union 统一）      独立
B4（IPC 归位）──→ B5（gateway，B4 的落盘逻辑直接用新 gateway）
B6（前端约定）──→ C2（useChatController 拆分在统一封装之后做，避免二次返工）
   ↓
C3 / C4 / C5 / C6（相互独立，可按需排期）
```

### 5.2 每一步的统一验收标准

1. `pnpm check`（oxlint + typecheck + test:unit）全绿；
2. 涉及主进程的项加跑 `pnpm test:e2e:electron`，涉及渲染层的加跑 `pnpm test:e2e:renderer`；
3. 不新增任何 `window.chaptaleDesktop` 直连、不新增裸 channel 字符串、不新增跨包重复类型；
4. 一个逻辑改动一个 commit（`refactor: ...`），可独立 revert。

---

## 6. 不建议动的部分

这些是扫描确认的优良设计，重构时应作为"保护对象"而非改造对象：

1. **`packages/shared` 与 `packages/ipc-contract` 的定位与内容**——纯净、单向依赖、被充分消费，是重构后的基线。
2. **主进程 IPC 架构**——按域 7 个薄文件 + `handleTrustedIpc` 集中网关 + 零裸 channel + preload 单命名空间严格实现契约。这套"契约驱动 IPC"是全仓最扎实的设计。
3. **`main/agent`、`main/sessions`、`main/models` 的 mapper/factory 隔离层**——pi SDK 细节被干净地挡在映射层之内。
4. **settings store 的聚合 + 分域 action 拆法**（`stores/settings/*` + `SettingsStoreContext`）——应作为其他 store 的模板，而非被"统一"掉。
5. **`components/` 设计系统的族目录规范**（App* + types + constants + barrel + tests）。
6. **electron.vite.config.ts 第 13–28 行的手动 external 列表及其注释**——那是绕开工具链 bug 的刻意设计（见附录），别"顺手优化"掉。
7. **`design-docs/`**——含 `NOTE_DONT_REWRITE_OR_EDIT` 标记，任何清理动作绕开它。

---

## 7. 附录：测试现状与工具链已知坑

### 7.1 测试组织

- 单一根 `vitest.config.ts`，`projects` 分 `ui`（happy-dom）/ `desktop`（node）/ `shared`（node）三个子项目；各包 `test` 脚本 `cd ../..` 回根跑对应 `--project`。
- coverage 阈值：statements 80 / branches 70 / functions 85 / lines 80；显式排除 ipc-contract、agent-core、HistoryView、ipc/preload/tools/factory。
- e2e：`playwright.config.ts`（渲染层，webServer 起 vite 5173）+ `playwright.electron.config.ts`（Electron，串行单 worker，先 `build:desktop`）。

### 7.2 工具链已知坑（重构时会踩到的）

1. **electron-vite external**：`build.externalizeDeps` 在 electron-vite 5.0.0 + vite 8 下实测未生效；且全量打包依赖会触发 rolldown 丢弃入口 chunk（`dist/main/index.js` 变 0 字节）。因此 `electron.vite.config.ts` 手动维护 external 列表（从 package.json dependencies 生成，仅 `ipc-contract`/`shared` 打进 bundle）。**任何给 desktop 增删 dependency 的重构步骤（尤其 B1 删 agent-core）都要同步这份手动列表。**
2. **包的双轨解析**：类型走 `dist/index.d.ts`（需 `turbo build` 产出）、运行时走 `src/index.ts` 源码别名。改 packages 导出面后若 IDE 类型不刷新，先 `pnpm build:shared`（或对应包）再看。
3. **IPC 传参必须是纯对象**（Vue 的 reactive Proxy 不能直接过 `structuredClone`），主进程改动需重启应用——历史经验，见项目记忆。

### 7.3 本文档的证据来源

全部结论基于对以下内容的逐文件扫描与全仓 grep 验证：`packages/*/src` 逐文件行数与消费方反查、`apps/desktop/src` 全目录树与 IPC channel 字面量审计、`apps/desktop-ui/src` 214 文件体量统计与 `window.chaptaleDesktop` 调用点清点、根配置五件套（turbo/tsconfig/vitest/playwright×2）与 `.gitignore`/`git ls-files` 交叉验证。
