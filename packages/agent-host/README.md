# @chaptale/agent-host

Chaptale 的 pi SDK 接入边界，运行于 Node 宿主，不供 Renderer 导入。当前是第一步接入，旧桌面 Agent 尚未切换到此包。

## 当前接口

`createHostSession()` 接受显式工作目录、应用资源目录、系统提示词，以及调用方装配的 `ModelRuntime` 和原生 `SessionManager`，返回 pi 的 `CreateAgentSessionResult`。不复制会话、模型协议或 Agent 循环。

- 两个目录必须是已存在的绝对目录，会话的工作目录必须与宿主一致；目录不是权限沙箱。
- 系统提示词始终按文本使用，不把恰好存在的文件路径解释为文件输入。
- 不自动读取目录中的设置、凭据、模型配置、扩展、Skills、提示词模板和上下文文件，也不加载 `SYSTEM.md` / `APPEND_SYSTEM.md`。凭据与模型配置由传入的 `ModelRuntime` 决定。调用方可以通过 pi 原生接口加载应用管理的凭据存储与 `models.json`；本函数不重复加载，也不禁止这些能力。
- 每个会话使用独立的内存设置，默认关闭额外缓存保温请求；正常模型请求的缓存行为仍由 pi 负责。
- 当前工具允许列表为空。权限与工具装配尚未接入，这不是最终产品删除 read、bash、MCP 或 Skills 的决定，也不是操作系统隔离。
- 调用方持有会话，负责停止活跃运行后释放它；本包不绑定窗口生命周期，也不提供单写者锁或跨进程协调。

包仅导出本步接口，不重导出整个 pi SDK。需要使用原生 SDK 的宿主应声明自己的直接依赖。`pi-ai` 目前只被测试用于装配无凭据的离线模型运行时，因此列为开发依赖。

## 验证

在仓库根目录执行：

```sh
pnpm --filter @chaptale/agent-host typecheck
pnpm --filter @chaptale/agent-host test
```

当前 lockfile 解析到 pi-coding-agent / pi-ai **1.0.4**。catalog 使用兼容范围，升级时正常更新 lockfile 并回归，不永久冻结版本。

测试使用真实 SDK、临时目录与自然退出的 Node 子进程，覆盖提示词与资源隔离、独立会话、默认保温关闭和无效输入。不替换 SDK 函数、不使用模拟模型服务器，不发起模型请求。

第一步只验证空会话接入。原生 JSONL 保存与重开、工具授权、Code Mode、MCP、真实模型以及 Electron/Android 新版本集成仍需后续逐步验证。旧 `runtime-validation` 中 pi 1.0.2 的宿主证据不是本包在 1.0.4 下的完整兼容证明。
