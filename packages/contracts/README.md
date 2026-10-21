# @chaptale/contracts

跨平台应用传输信封，包含 `RpcCommand`、`RpcRequest`、`RpcReply`、`RpcPacket` 和 `RpcClient`。全部为类型定义，可用于界面、Node 宿主和平台桥接。

请求 ID 用于匹配当前连接中的响应；作品的持久 commandId、回执和事件游标由作品契约定义。Agent 与作品分别定义命令表及事件类型，并使用公共信封。

请求关联实现位于 `@chaptale/ui/client`；Electron 的进程启动和消息投递留在桌面平台代码。
