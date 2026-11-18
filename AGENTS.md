# Chaptale Agent 工作指南

Chaptale 是面向小说与剧本的跨平台创作 IDE，正在重建为由 pi SDK（`@earendil-works/pi-coding-agent`）支撑的通用 Agent harness。本文件约束在本仓库工作的编码 Agent；用户手册见 `docs/`，开发与发布流程见 `CONTRIBUTING.md`。

## 信息来源与权威顺序

1. 当前对话中用户的明确指示。
2. `temp/handoff.md`：上一轮交接，说明未提交改动、待确认问题与下一步。（`temp/` 被 Git 忽略，可能不存在。）
3. `design-docs/PRODUCT.md`：已确认的产品规则，其他设计文档引用这里。历史批次里的提交授权不能继承。
4. `design-docs/README.md` 索引的其余设计文档（产品范围 `PRODUCT.md`，架构 01，数据 02，Agent 03，平台 04）。设计文档描述目标，不代表已经实现。
5. 代码与测试是“当前行为”的唯一事实来源；文档与代码冲突时以代码为准，并在交付说明中指出。

`design-docs/` 和 `temp/` 都被 Git 忽略，修改它们不会进入提交。

## 仓库结构

| 路径                  | 包名                   | 职责                                                                                  |
| --------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `packages/agent-host` | `@chaptale/agent-host` | Node 宿主内的 pi SDK 接入：模型运行时、原生会话池、工具授权、应用会话入口与传输协议。 |
| `packages/creation`   | `@chaptale/creation`   | 作品业务、作者应用入口与仓储接口；纯契约从 `/contracts` 导出。                        |
| `packages/storage`    | `@chaptale/storage`    | SQLite 连接、schema、事务、仓储实现与真实存储集成测试。                               |
| `packages/contracts`  | `@chaptale/contracts`  | 跨平台公共传输信封与客户端接口类型。                                                  |
| `packages/ui`         | `@chaptale/ui`         | 应用客户端；`/client` 提供请求关联与事件转发。                                        |
| `apps/desktop`        | `@chaptale/desktop`    | Electron 平台；`src/main/application-host/` 共用进程运行 Agent 与作品服务。           |
| `apps/desktop-ui`     | `@chaptale/desktop-ui` | Vue 界面（Renderer），不得导入 agent-host 的 Node 运行时代码，只能使用 `/protocol`。  |
| `docs/`               | —                      | VitePress 用户手册，按实际界面与实现编写。                                            |
| `e2e/`、`scripts/`    | —                      | Electron Playwright 测试与发布脚本。                                                  |
| `mobile-virtual/`     | —                      | 被忽略的 Android 实验环境与证据，不是正式移动应用；不得清理、停止设备或当作生产部署。 |

agent-host 子路径入口：`.`（会话池与模型运行时）、`./application`（`HostApplication` 与通用 Node 启动装配）、`./protocol`（纯类型与持久化常量，无 Node 依赖）。

creation 子路径入口：`.`（作品服务与仓储接口）、`./contracts`（纯数据契约）、`./application`（作者请求入口）。`@chaptale/storage` 导出 `openCreationStorage`，实现 creation 定义的 `CreationRepository`，由启动代码注入。Renderer 只使用业务纯契约与应用客户端；依赖方向与循环依赖由 oxlint 检查。

agent-host 内部按领域分目录：`protocol/`、`application/`、`conversation/`、`permissions/`、`work/`、`instructions/`、`skills/`、`mcp/`、`runtime/`、`session/`、`settings/`、`tools/`。`protocol/` 只放纯类型与持久化常量。

desktop-ui 的 feature 依赖自下而上：`notifications` → `settings`、`creation`、`workbench` → `story`、`cloud-sync` → `editor` → `explorer`、`agent` → `shell`。设置页分区放在拥有数据的 feature，面板外壳在 `shell`；下层需要上层能力时由 `layouts/` 接入，不反向导入。

桌面 preload、主进程与 Renderer 共用 `apps/desktop/src/bridge/`：`@chaptale/desktop/bridge` 入口只导出纯类型与无 Electron 依赖的常量、守卫；参数校验器（`bridge/schemas`、`app.ts`、`window.ts` 中的 Validator）只给 main 与 preload；Electron 通道归 `bridge/channels.ts`，主进程桥接归 `application-host/ipc.ts`。

## 环境与命令

- Node.js >= 24，pnpm 版本由根 `package.json` 固定；在 Windows 11 + Git Bash 下开发。
- Turbo 2.x 编排任务。修改 `turbo.json` 或 Turbo 命令前，先阅读文末托管块要求的已安装版本文档。
- 格式化用 `oxfmt`（配置 `.oxfmtrc.json`：120 列、单引号、无尾逗号、LF），lint 用 `oxlint`（`.oxlintrc.json`）。不要使用 prettier 或 eslint。
- 测试使用 Vitest，项目定义在根 `vitest.config.ts`（`agent-host`、`ui`、`desktop` 等）。

常用检查（仓库根目录）：

```sh
pnpm format:check
pnpm lint
pnpm typecheck                     # 怀疑缓存时改用 pnpm exec turbo run typecheck --force
pnpm --filter @chaptale/agent-host test
pnpm --filter @chaptale/storage test
pnpm --filter @chaptale/ui test
pnpm test:unit                     # 全仓单测，较慢
```

完整提交前检查清单见 `CONTRIBUTING.md`。改动范围小时，可只跑受影响包的检查，但在交付说明中写清实际运行了什么、没运行什么。

## 工作流程

- 流程：说明范围 → 实现 → 验证 → 人工 review → 获得确认后才本地 commit。**未经用户明确授权，不 commit、不 push、不建分支。** 授权只对当前批次有效。
- 提交信息使用 Conventional Commits（如 `feat(agent-host): ...`），用英文，作用域取包名去掉 `@chaptale/` 前缀。
- 先读后写。能从代码、配置、日志查证的事情自行查证；影响实现的需求歧义直接询问，不用临时方案补需求。
- 按可运行的功能闭环组织批次，不按单个函数机械拆分；不擅自扩大改动面。
- 交接写入 `temp/handoff.md`（覆盖旧内容），只写其他文档里没有的信息，并引用路径。保留现有头标题和头部提示原文，只更新交接正文。

## 需求讨论与表达

- 讨论前回顾核心行为规范和重构规范。语气自然，技术判断明确。
- 需求或设计有任何不清晰的地方，或者认为用户的方案不合理，应直接询问、提出反对理由和替代方案，不迎合、不替用户猜决定。能从代码、配置和文档查明的事实自行核实。
- 从当前创作目标出发，可以大胆重划模块和操作流程。不反复搬出之前的设计，也不因方案已经写入文档就保留；明确说明建议解决什么问题、有什么代价，获得确认后再修改。
- 提问和文档使用 `shuorenhua`、`avoid-ai-writing`、`stop-slop` 等适用 skill。实际读取后再应用，用户要求重读时重新读取；用具体场景、准确用词和简短问题，避免模糊表述、套话与生硬的术语堆砌。
- 按依赖关系分轮对齐，每轮给出建议并等待回答；不重复询问已确认事项，不把常规交互拆成一串问题。讨论通过不等于实现授权，文字方案通过不等于实操验收。

## 工程约束

- **复用 pi，不复制 pi。** 直接使用原生 `AgentSession`、`SessionManager`、`ModelRuntime`、事件与 JSONL 格式；不自建模型循环、会话树、消息格式或工具调度器。依赖跟随上游升级，不 fork、不冻结版本。
- **按领域职责组织代码。** 应用服务协调用例、事务与事件；正文修订、目录约束、候选演进和审阅决策归各自领域模块。规则与依赖混杂时及时拆分，不按行数机械切文件，也不为 DDD 增设空洞分层或接口。重构前后通过公共接口测试验证行为与契约。
- **只实现已确认的需求。** 不加预留接口、未要求的后台任务或兼容层；被替代的代码直接删除。设计文档里写明后续要用的契约（如快照、游标、授权、传输信封）属于已确认需求，即使暂时没有消费者，也不能当作死代码清理。
- **不兼容旧实现。** 旧接口、配置与历史格式不做迁移兼容，但真实作品与历史原件不得删除或静默改写。
- **配置在应用内完成。** 常用设置提供界面，高级设置沿用 pi 原生配置；不恢复根目录 `agent.config.json`，不新建第二套配置语言。
- **界面重新设计。** `DESIGN.md` 只能参考配色；布局、字体、控件与交互以 `design-docs/PRODUCT.md` 为准，参照 VS Code / Zed / Cursor 等编辑器的通行做法，按 `impeccable` skill 的方法设计与评审。
- **界面验收由用户完成。** 用户通过 `pnpm dev` 检查界面表现与渲染。Agent 负责实现、静态检查和自动化行为测试，交付时给出“入口 → 操作 → 预期结果”；用户另行要求时才做截图或视觉、渲染检查。
- **工具默认不开放。** 每次直接或嵌套调用都要经过授权边界；拒绝、失败、取消和迟到的批准都不得执行工具。
- **历史严格打开。** 损坏或缺少指令记录的历史只读打开并提示原因，不能继续对话；需迁移的历史明确报错。两种情况都不自动修复、不套用当前默认值。
- 代码注释与报错文案使用中文，与现有代码保持一致。

## 测试规范

- 测试只验证产品的公共行为与契约，使用真实 SDK 与临时目录；不伪造模型回复，不用全局 mock 掩盖失败。开发环境与调试快捷键不单独编写测试。
- 修复竞态或边界问题时，先确认新测试能在注入故障后失败，再在修复后通过。
- 离线测试不得联网。`test:live*` 会调用真实模型、可能计费，仅在用户明确要求时运行，配置与派生数据只能放在 `temp/`。
- 只有真实运行通过的能力才能宣称完成。缺少模型、设备或服务时如实写明未验收；离线夹具、入口存在或其他平台的结果不能替代。LSP 返回空结果或超时不等于检查通过，以实际编译和测试为准。

## Vue / Electron 踩坑记录（受保护）

**本节由用户要求长期保留。未经用户明确授权，不得删除本节或其中条目，也不得以整理、去重、压缩交接或迁移到 `temp/` 为由移除。依赖升级后可补充适用版本和新结论，保留问题原因与处理依据。**

### 1. 跨进程数据与状态快照

- **适用范围**：Electron IPC、`postMessage`、结构化克隆及异步状态持久化。
- **风险机制**：Vue 响应式代理、DOM 节点、原生事件和函数等值可能触发 `An object cannot be cloned` 或 `DataCloneError`。`toRaw()` 只处理最外层代理；数组筛选、对象重组后，嵌套字段仍可能携带代理。异步请求持有可变对象时，还会受到后续修改影响。
- **实施要求**：
  - 按传输契约构造独立数据对象，解引用响应式值，逐项提取事件所需字段。对象身份与界面键使用稳定 ID，显示名称允许重复。
  - 在请求入队时捕获独立快照，回执只确认对应快照。契约限定为纯 JSON 数据时，可通过 JSON 序列化捕获快照；二进制、日期等值采用保留其契约语义的表示方式。
  - 业务失败通过明确的错误码与消息传递，调用端按协议处理；需要跨进程保留的异常属性应显式纳入数据契约。
- **核查重点**：嵌套代理、集合重组、同名对象、连续提交及请求期间继续修改。

### 2. 组件组合、DOM 引用与实例生命周期

- **适用范围**：通过 `as-child`、插槽转发或 VNode 克隆组合组件，以及挂载编辑器等命令式实例。
- **风险机制**：组件库可能改写插槽节点的属性和引用；Vue 编译器可能提升、复用静态属性对象，两者叠加会影响重复挂载。TypeScript 非空断言在编译时移除；接受可选挂载容器的库可能创建脱离页面的实例，使容器留空且没有运行时异常。
- **实施要求**：
  - 明确 DOM 引用的持有者。交由组件库处理的触发节点与命令式实例的挂载节点分离，由业务组件持有内部挂载节点。
  - 在挂载节点就绪后创建实例，卸载时释放实例及其订阅。编辑器实例、DOM 和编辑器内部状态使用普通对象、非响应式容器或浅层引用；界面元数据按需使用 Vue 响应式状态。
  - 按依赖版本核实节点克隆与引用转发行为。排查空白区域时同时检查容器尺寸、实际子节点和挂载引用的连接状态。
- **核查重点**：首次挂载、重复挂载、组件切换、同类组件多实例及卸载重建。

### 3. 浮层焦点、输入事件与快捷键

- **适用范围**：菜单操作打开输入框、弹窗或编辑器，以及文本查找、替换等输入交互。
- **风险机制**：浮层关闭时的默认焦点恢复可能覆盖业务操作设置的新焦点。仅监听键盘抬起事件会遗漏粘贴和输入法提交。
- **实施要求**：
  - 在浮层关闭及焦点恢复的生命周期中协调后续操作。需要转移焦点时，由业务操作接管；取消浮层时沿用组件库的默认恢复行为。
  - `AppDropdownMenu` 通过 `closeAutoFocus` 交接焦点，业务接管时先调用 `preventDefault()` 再聚焦。`AppContextMenu` 在 `close-auto-focus` 阶段派发 `select`，后续操作在该回调中打开输入控件。
  - `AppAlertDialog` 的确认按钮先触发 `update:open(false)`，再派发 `confirm`。确认操作的目标与打开状态分开保存，关闭时不清空目标。
  - 通过 `input` 和输入法组合事件处理文本变化，明确组合输入进行中与提交后的处理时机。
  - 使用编辑器提供的命令与快捷键作用域，并按平台惯例注册应用快捷键。
- **核查重点**：菜单确认与取消后的焦点、粘贴、中文输入提交、键盘操作与作用域切换。

### 4. 保存边界与撤销历史

- **适用范围**：具有输入合并、异步保存和撤销重做能力的编辑器。
- **风险机制**：编辑器可能将保存前后的连续输入合并为一次撤销；保存回执若直接采用当前内容作为基线，会混入请求发出后的修改。测试时间戳还可能与编辑器使用的内部哨兵值冲突。
- **实施要求**：
  - 捕获保存快照时，通过编辑器原生历史接口建立撤销边界；保存回执确认送出的快照，后续输入继续保留各自的未保存状态。
  - 保留既有撤销与重做记录，验证撤销能够回到保存点，并继续回溯更早的修改。
  - 时间相关测试使用固定、符合真实日期范围的时间戳，核实依赖对零值、时间间隔及历史分组的约定。
- **核查重点**：保存前后连续输入、请求期间输入、迟到回执、撤销至保存点及重做后的状态。

### 5. 首轮样式与运行模式差异

- **适用范围**：按需生成 CSS、主题变量、遮罩图标，以及开发和生产模式的界面排查。
- **风险机制**：样式请求可能早于组件提取；基础变量缺失会使依赖变量的尺寸计算失效。开发与生产模式的样式提取顺序、组件编译结果及窗口启动顺序可能不同。
- **实施要求**：
  - 让基础主题变量随首轮样式完整生成。使用 UnoCSS Wind4 时，显式启用完整主题预设输出，确保尺寸、间距等变量在组件首次显示时可用。
  - 图标检查同时覆盖对应的 CSS 规则、`mask-image` 和实际宽高。
  - 按实际故障入口区分冷启动、重载、组件切换及开发与生产模式。多窗口诊断按应用 URL 选择 Renderer，使用独立临时用户目录。
  - 排查结束后清理开发环境专项诊断脚本与测试。长期测试围绕用户可观察的产品行为和公共契约组织。
- **核查重点**：首轮主题变量、图标尺寸、组件重复挂载、目标窗口与数据隔离。

### 6. 跨库提交与中断恢复

- **适用范围**：作品 SQLite 与本机 `library.sqlite` 之间的正式保存、恢复草稿和修改审阅。
- **风险机制**：两个数据库独立提交。正式修订已成功后，本机进度仍可能写入失败；重试整个操作会重复保存，直接清除候选会丢失待处理内容。
- **实施要求**：
  - 正式修订和命令回执在作品库的一次事务中提交，再凭回执清理本机草稿或更新审阅进度。恢复阶段只补齐已有回执对应的进度，未提交的旧修改由作者重新发起。
  - 记录审阅提交意图前确认目标候选存在，避免无效请求留下阻塞后续恢复的记录。
  - 作品更新时间由 `listWorks` 查询条目时派生，不恢复跨库 `ATTACH` 来同步作品时间。
- **核查重点**：正式提交失败、本机进度失败、重启恢复、重复命令，以及恢复期间保留后续输入和候选。

### 7. 候选版本、目录位置与会话视图

- **适用范围**：Agent 待接受修改、作者手改候选、逐块审阅和会话内目录投影。
- **风险机制**：正文修订身份、目录位置和候选版本分别变化。作者移动正式文稿时正文修订可以保持不变；会话内移动候选还会改变其他同级条目的显示位置。
- **实施要求**：
  - 接受操作同时校验候选版本、正式修订和目录位置。作者手改产生新候选版本，迟到的接受请求与 Agent 覆盖均按版本规则处理。
  - 候选正文变化时同步更新字数和版本元数据；会话目录统一投影同级位置。单独接受改名时保持该条目的正式位置，其他候选移动继续留待审阅。
  - 正式读取与检索和本会话候选视图区分；会话检索使用的临时索引在查询结束时清理，其他会话和正式索引保持各自内容。
- **核查重点**：手改后的字数、陈旧决定、只移动目录位置、同级重排、部分接受与拒绝，以及跨会话读取隔离。

### 8. 公共入口、界面守卫与 SDK 测试夹具

- **适用范围**：Renderer 控件、跨 feature 导入、包子路径导出与真实 SDK 会话测试。
- **风险机制**：业务组件绕过公共控件或导入内部文件会破坏界面和依赖约束；导入了错误的包入口、或夹具缺少系统指令，会在到达被测行为前失败。
- **实施要求**：
  - 业务表单使用 `AppInput` 等通用控件；`ui-consistency.test.ts` 检查原生 `input`、`select` 和 `textarea`。需要聚焦原生输入时，按组件实际结构获取内部节点。
  - 跨 feature 只使用目标的 `index.ts` 公共出口，feature 之间的依赖不成环，均由 `feature-public-api.test.ts` 检查。`HostModelConfiguration` 从 `@chaptale/agent-host` 导出；桌面测试客户端类型从 `@chaptale/desktop/bridge` 导入。
  - 创建 SDK 会话的夹具提供非空 system 指令。经过会吞入错误状态的 store 入口后，先检查 `agent.error`，再断言业务结果。
- **核查重点**：公共出口、控件守卫、夹具创建结果，以及失败实际发生在哪个入口。

### 9. 工具环境、诊断缓存与错误边界

- **适用范围**：Windows 下的命令执行、格式检查、TypeScript/LSP 诊断与静态规则告警。
- **风险机制**：工具使用的 shell 与 Git Bash 可能不同；LSP 和规则缓存可能保留编辑中间态。格式化工具的忽略规则也可能使单文件命令跳过目标。
- **实施要求**：
  - 使用 context-mode 时核实执行 shell；本机 `ctx_execute` 的 shell 为 PowerShell，调用 pnpm 可经 `cmd.exe /d /s /c`。格式化单文件被忽略时改传所属目录，并核对实际覆盖范围。
  - 类型诊断指向旧签名时，主动读取当前位置和类型，再运行实际编译；怀疑增量缓存时使用项目的强制构建检查。根目录未直接依赖 TypeScript 时，使用受影响包的 `typecheck` 脚本。
  - 标记误报前查清调用链和现有错误边界。仓储自己写入的 JSON 解析失败应交由应用入口报告，保留损坏信息；不要为静态规则增加吞错或默认值。
- **核查重点**：当前源码与告警位置、工具退出码、检查覆盖范围，以及异常是否已经由上层处理。

### 10. Electron 行为测试与实例隔离

- **适用范围**：Electron Playwright 测试、构建产物和本机开发实例。
- **风险机制**：旧构建产物会让测试执行过时代码；共享用户目录或批量终止进程会干扰作者正在运行的应用。
- **实施要求**：
  - 测试前先运行 `pnpm build:desktop`，再按现有 Electron Playwright 配置运行目标用例；诊断单个用例时可使用 `--workers=1`。
  - 使用独立临时用户目录，只关闭本轮测试启动的 Electron 实例。`mobile-virtual` 的设备与进程保持原状。
  - 自动化验证公共行为，界面表现按本文件的人工验收约定交给用户。
- **核查重点**：实际构建版本、用户数据目录、进程归属和测试入口。

## 敏感信息

- `temp/test-models.json` 及旧名 `temp/test-modes.json` 等模型配置包含凭据：不要读取或输出内容，不要复制到被跟踪的路径。
- 不提交证书、模型密钥或个人配置。

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
