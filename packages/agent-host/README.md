# @chaptale/agent-host

供 Node 宿主使用的 pi SDK 接入包，管理应用模型配置、原生会话和工具授权。Renderer 不应导入；桌面生产 Agent 和正式移动端 UI 尚未切换到此包。

## 使用

先用 `createHostModelRuntime({ configDir })` 装配模型运行时，再用 `HostSessionPool.create({ agentDir, sessionDir, modelRuntime })` 创建会话池。目录均须是已存在的绝对路径；配置和历史应放在应用管理的目录，不使用开发机全局 pi 目录。

模型运行时读取 `configDir` 下的 `auth.json`、`models.json` 和 `models-store.json`，不联网刷新模型目录。配置损坏时拒绝装配；没有可用模型时返回待配置的运行时。凭据仍遵循 pi 的原生机制，包括环境变量。

| 会话池方法                        | 用途                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- |
| `createSession(input)`            | 新建会话；input 提供 `cwd`、`systemPrompt`，可选 `model` 和 `toolAccess`。 |
| `openSession({ ...input, file })` | 严格打开池目录内的已有历史。                                               |
| `get(id)`                         | 取得已有的原生会话；关闭中的会话不可取得。                                 |
| `list()`                          | 列出当前持有的会话及 `idle / running / closing` 状态，不扫描历史。         |
| `close(id)`                       | 取消并释放一个会话。                                                       |
| `dispose()`                       | 停止接收新会话，等待已接收的装配，再取消并释放全部会话。                   |

创建和打开返回 pi 的 `CreateAgentSessionResult`，直接使用 `session.prompt()`、`steer()` 和原生事件。关闭与释放不删除 JSONL。同进程内的池不能同时持有同一文件；池内也拒绝相同会话 ID 的历史副本。

如需自行管理生命周期，可将原生 `SessionManager` 与 `ModelRuntime` 传入 `createHostSession()`；恢复历史时先调用 `openHostSessionManager({ file, cwd })`。使用原生 SDK 的调用方应声明自己的直接依赖，本包不重导出整个 SDK。

## 应用会话入口（尚未接入平台 UI）

`@chaptale/agent-host/application` 导出 `HostApplication`，由 Node 宿主装配模型运行时、目录、工具以及应用设置的保存回调。`@chaptale/agent-host/protocol` 只提供传输类型，不包含 Node 运行时代码。

已实现的提示词链路：

- 装配时显式提供应用默认提示词；`defaultSystemPrompt` 命令先调用设置保存回调，成功后只影响新建会话。没有内置创作提示词或根目录参数文件。
- `systemPrompt` 命令修改单个会话；原生 JSONL 的自定义记录保存其值。下一次发送前通过 SDK 的 `reload()` 应用，不中途替换运行中的提示词。
- 历史重开读取该会话自己的提示词，不套用后来修改的应用默认值。缺少该记录的历史明确拒绝打开，不自动迁移或覆盖；底层原生会话池接口不受影响。
- `snapshot()` 和 `subscribe()` 提供界面投影与进程内游标；读取快照、断开订阅不新建或取消会话。游标不是持久投递回执。

应用默认值的实际存储、系统凭据存储、Electron/Android IPC 和配置界面由平台接入负责，目前均未完成。其他命令已有初步实现，但流式事件、桥接授权与取消仍须真实模型和双端验收，不能据此宣称正式宿主闭环已完成。空会话仍遵循 SDK 首条消息前不落盘的行为。

## 默认行为与边界

- `systemPrompt` 必须非空，接受文本或返回文本的函数；函数在装配和显式资源重载时求值，不自动热更新。文本始终按内容而非文件路径使用。会话工作目录须与 `cwd` 一致。宿主不自动发现目录中的配置、扩展、Skills、提示词或上下文文件；每个会话使用独立内存设置，默认关闭额外缓存保温请求。
- `model: { provider, id }` 只选择已注册模型，未知引用报错；省略时由 SDK 恢复历史模型或选择默认模型。模型地址和凭据由 `ModelRuntime` 管理。
- 默认没有工具。`toolAccess` 提供原生 `ToolDefinition[]` 和 `authorize(request, signal)`，每次直接或嵌套执行都重新授权。授权方只接收会话信息和参数快照；授权被拒绝、失败或在等待期间取消时，都不会启动工具；迟到的批准也无效。未登记工具被阻断。
- `openHostSessionManager()` 在恢复前检查普通文件、当前 SDK 版本、UTF-8/JSON 行、工作目录和基本历史链。文件缺失、损坏、缺少末尾换行或需要迁移时抛出带 `code` 的 `HostSessionOpenError`，不让 SDK 自动修复原件。空会话在首条 user/assistant 消息前不落盘。

工具实现是受信任的宿主代码，工作目录和授权回调不构成 OS 沙箱。单写者保护仅限本进程通过池操作的文件，不覆盖外部写入；直接管理会话的调用方须自行持有写入权。附件存储、平台 IPC、持久任务及 MCP、Code Mode 等扩展接入不属于当前实现。

## 验证

在仓库根目录运行离线检查，测试不调用模型：

```sh
pnpm --filter @chaptale/agent-host typecheck
pnpm --filter @chaptale/agent-host test
```

以下是会联网、可能产生费用的手动入口，不属于普通测试或 CI：

```sh
pnpm --filter @chaptale/agent-host test:live "<仓库绝对路径>/temp/<测试配置>.json"
pnpm --filter @chaptale/agent-host test:live:host "<仓库绝对路径>/temp/<测试配置>.json"
pnpm install:electron
pnpm --filter @chaptale/agent-host test:live:electron "<仓库绝对路径>/temp/<测试配置>.json"
```

配置接受 pi 原生 `providers` 对象或 provider 映射；多模型配置需在路径后指定 `provider modelId`。配置文件及派生数据必须位于被 Git 忽略的 `temp/`。脚本隔离开发机凭据，不回显原始配置，成功和失败记录均写入 `temp/pi-live-*`，不自动删除。输出限制、超时和取消都不是费用硬上限。

`test:live` 验证回复、续聊和取消；另两个入口验证并发会话、直接与嵌套工具、撤权、取消隔离和新进程续聊。Electron 在真实 `utilityProcess` 中运行，会话池释放后由父进程回收；这不验证自然退出或生产崩溃恢复。
