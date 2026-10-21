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

| 路径                  | 包名                     | 职责                                                                                   |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `packages/agent-host` | `@chaptale/agent-host`   | Node 宿主内的 pi SDK 接入：模型运行时、原生会话池、工具授权、应用会话入口与传输协议。  |
| `packages/creation`   | `@chaptale/creation`     | 跨平台作品业务与 SQLite 存储；纯契约从 `/contracts` 导出，存储由启动代码注入。         |
| `packages/ipc`        | `@chaptale/ipc-contract` | Electron 主进程与界面之间的 IPC 契约。                                                 |
| `packages/shared`     | `@chaptale/shared`       | 跨端共享的领域类型与工具。                                                             |
| `apps/desktop`        | `@chaptale/desktop`      | Electron 主进程与打包；用 `utilityProcess` 运行 agent-host（`src/main/agent-host/`）。 |
| `apps/desktop-ui`     | `@chaptale/desktop-ui`   | Vue 界面（Renderer），不得导入 agent-host 的 Node 运行时代码，只能使用 `/protocol`。   |
| `docs/`               | —                        | VitePress 用户手册，按实际界面与实现编写。                                             |
| `e2e/`、`scripts/`    | —                        | Electron Playwright 测试与发布脚本。                                                   |
| `mobile-virtual/`     | —                        | 被忽略的 Android 实验环境与证据，不是正式移动应用；不得清理、停止设备或当作生产部署。  |

agent-host 子路径入口：`.`（会话池与模型运行时）、`./application`（`HostApplication` 与通用 Node 启动装配）、`./protocol`（纯类型与持久化常量，无 Node 依赖）。

creation 子路径入口：`.`（作品服务与存储接口）、`./contracts`（纯数据契约）、`./storage`（SQLite 装配）。业务通过 `CreationRepository` 访问存储，Renderer 只使用 `/contracts`；依赖方向与循环依赖由 oxlint 检查。

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
pnpm --filter @chaptale/creation test
pnpm test:unit                     # 全仓单测，较慢
```

完整提交前检查清单见 `CONTRIBUTING.md`。改动范围小时，可只跑受影响包的检查，但在交付说明中写清实际运行了什么、没运行什么。

## 工作流程

- 流程：说明范围 → 实现 → 验证 → 人工 review → 获得确认后才本地 commit。**未经用户明确授权，不 commit、不 push、不建分支。** 授权只对当前批次有效。
- 提交信息使用 Conventional Commits（如 `feat(agent-host): ...`），用英文，作用域取包名去掉 `@chaptale/` 前缀。
- 先读后写。能从代码、配置、日志查证的事情自行查证；影响实现的需求歧义直接询问，不用临时方案补需求。
- 按可运行的功能闭环组织批次，不按单个函数机械拆分；不擅自扩大改动面。
- 交接写入 `temp/handoff.md`（覆盖旧内容），只写其他文档里没有的信息，并引用路径。

## 需求讨论与表达

- 讨论前回顾核心行为规范和重构规范。语气自然，技术判断明确。
- 需求或设计有任何不清晰的地方，或者认为用户的方案不合理，应直接询问、提出反对理由和替代方案，不迎合、不替用户猜决定。能从代码、配置和文档查明的事实自行核实。
- 从当前创作目标出发，可以大胆重划模块和操作流程。不反复搬出之前的设计，也不因方案已经写入文档就保留；明确说明建议解决什么问题、有什么代价，获得确认后再修改。
- 提问和文档使用 `shuorenhua`、`avoid-ai-writing`、`stop-slop` 等适用 skill。实际读取后再应用，用户要求重读时重新读取；用具体场景、准确用词和简短问题，避免模糊表述、套话与生硬的术语堆砌。
- 按依赖关系分轮对齐，每轮给出建议并等待回答；不重复询问已确认事项，不把常规交互拆成一串问题。讨论通过不等于实现授权，文字方案通过不等于实操验收。

## 工程约束

- **复用 pi，不复制 pi。** 直接使用原生 `AgentSession`、`SessionManager`、`ModelRuntime`、事件与 JSONL 格式；不自建模型循环、会话树、消息格式或工具调度器。依赖跟随上游升级，不 fork、不冻结版本。
- **只实现已确认的需求。** 不加预留接口、未要求的后台任务或兼容层；被替代的代码直接删除。设计文档里写明后续要用的契约（如快照、游标、授权、传输信封）属于已确认需求，即使暂时没有消费者，也不能当作死代码清理。
- **不兼容旧实现。** 旧接口、配置与历史格式不做迁移兼容，但真实作品与历史原件不得删除或静默改写。
- **配置在应用内完成。** 常用设置提供界面，高级设置沿用 pi 原生配置；不恢复根目录 `agent.config.json`，不新建第二套配置语言。
- **界面重新设计。** `DESIGN.md` 只能参考配色；布局、字体、控件与交互以 `design-docs/PRODUCT.md` 为准，参照 VS Code / Zed / Cursor 等编辑器的通行做法，按 `impeccable` skill 的方法设计与评审。
- **工具默认不开放。** 每次直接或嵌套调用都要经过授权边界；拒绝、失败、取消和迟到的批准都不得执行工具。
- **历史严格打开。** 损坏或缺少指令记录的历史只读打开并提示原因，不能继续对话；需迁移的历史明确报错。两种情况都不自动修复、不套用当前默认值。
- 代码注释与报错文案使用中文，与现有代码保持一致。

## 测试规范

- 测试只验证公共行为与契约，使用真实 SDK 与临时目录；不伪造模型回复，不用全局 mock 掩盖失败。
- 修复竞态或边界问题时，先确认新测试能在注入故障后失败，再在修复后通过。
- 离线测试不得联网。`test:live*` 会调用真实模型、可能计费，仅在用户明确要求时运行，配置与派生数据只能放在 `temp/`。
- 只有真实运行通过的能力才能宣称完成。缺少模型、设备或服务时如实写明未验收；离线夹具、入口存在或其他平台的结果不能替代。LSP 返回空结果或超时不等于检查通过，以实际编译和测试为准。

## 敏感信息

- `temp/test-modes.json` 等模型配置包含凭据：不要读取或输出内容，不要复制到被跟踪的路径。
- 不提交证书、模型密钥或个人配置。

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
