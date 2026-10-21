# @chaptale/ui

应用客户端通过 `/client` 导出 `RpcConnection<Commands, Event>`，复用 `@chaptale/contracts` 的传输信封。平台注入发送函数并将收到的包交给 `receive()`；客户端匹配并发响应、转发事件，在断线时拒绝在途请求。业务方决定如何重取快照和恢复状态。

连接层使用标准 Web Crypto 生成请求 ID，可在浏览器和支持该 API 的 Node 宿主运行。平台负责进程、MessagePort 或 IPC 生命周期。

```sh
pnpm --filter @chaptale/ui typecheck
pnpm --filter @chaptale/ui test
```

测试使用真实 MessageChannel，验证乱序响应、事件与请求分离、业务错误和断线后的迟到响应。
