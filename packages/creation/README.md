# @chaptale/creation

供 Node 宿主使用的作品业务包，负责作品、文稿与资料条目、修订和恢复草稿。当前通过真实 SQLite 的公共接口测试验证；桌面业务进程与新工作台接入继续按 A 批推进。

## 模块与入口

| 入口                             | 内容                                     | 使用方              |
| -------------------------------- | ---------------------------------------- | ------------------- |
| `@chaptale/creation`             | `CreationService`、存储接口、业务错误    | Node 业务与启动代码 |
| `@chaptale/creation/contracts`   | 作品、文稿、修订、草稿与错误的纯数据类型 | 界面、传输与业务    |
| `@chaptale/creation/application` | `CreationApplication`，作者请求入口      | Node 宿主           |

业务层通过 `CreationRepository` 访问存储；独立的 `@chaptale/storage` 实现连接、SQL、事务和序列化。宿主负责确定私有目录并注入存储，Renderer 从 `/contracts` 引用类型。作品业务和存储实现都运行在 Node 中。

```ts
import { CreationService } from '@chaptale/creation';
import { openCreationStorage } from '@chaptale/storage';

export async function openCreationService(rootDir: string): Promise<CreationService> {
  return new CreationService(await openCreationStorage({ rootDir }));
}
```

宿主退出时调用 `service.close()`，释放本机库和当前作品的连接。`.oxlintrc.json` 检查平台导入、业务对存储实现的直接引用及循环依赖。

## 作者应用入口

`CreationApplication` 接收宿主注入的仓储，`executeAuthor(command)` 校验方法和业务参数后执行作品操作。请求成功返回 `{ ok: true, value }`；修订、草稿和位置冲突返回可序列化的错误字段，便于界面保留输入并处理冲突。非法输入返回 `invalid-request`。

作者身份固定在这个入口，宿主应从受信任的作者通道调用；请求体只允许业务参数。`subscribe` 和 `close` 分别转发已提交事件、释放存储。当前入口已由真实存储集成测试验证，桌面传输接入继续推进。

## 当前接口与保存规则

- `createWork` / `listWorks`：创建作品、读取作品列表。
- `createEntry` / `listEntries`：创建文稿或资料目录及文档，读取条目元数据；`readDocument` 按需读取正文。
- `renameDirectory`：按期望修订改名，保留目录身份和子项；同名保存保留原修订。
- `moveEntry`：在当前文稿或资料区域内排序、跨目录移动，目录连同子项保持原身份和内部层级。
- `saveDocument` / `readRevision`：按期望修订保存、读取不可变修订快照。标题、格式和正文均相同时保留原修订。
- `writeDraft` / `readDraftState` / `discardDraft`：按草稿版本写入、恢复或丢弃输入。清理正文后保留版本标记，拒绝迟到写入。

创建、改名、移动与正式保存使用 `commandId`。相同命令和参数重试返回原结果，同 ID 改参数时报错。文稿内容、修订与命令回执在同一作品数据库事务中提交。

草稿快照的 `id` 作为该快照正式保存时的 `commandId`。正式保存按 ID 清理对应草稿；读取草稿时按作品库回执核对已提交快照，处理正式提交成功、草稿清理失败后的恢复。修订冲突与草稿冲突分别使用 `RevisionConflictError`、`DraftConflictError`，纯数据错误类型见 `/contracts`。

## 目录移动与并发

`moveEntry` 接收原条目的 `expectedParentId`、`expectedPosition`，目标 `parentId` 为 `null` 时移到当前区域根层级，`beforeEntryId` 为 `null` 时追加到末尾。指定参照条目时插到它之前。

服务在同一作品事务中校验原位置、目标目录和排序参照，调整两侧同级顺序并写入回执。原位置已变化时抛出 `EntryLocationConflictError`，携带实际父目录与位置；跨作品、跨区域及移入自身或子目录的请求会报错。

移动保留正文修订、保存时间和恢复草稿，作者可继续保存已打开文稿的输入。位置校验独立于正文修订；最新树状态通过 `listEntries` 读取，重试命令返回的是原操作回执。

## 快照与提交事件

- `snapshot(null)` 读取作品库快照；`snapshot(workId)` 读取作品树元数据。每份快照的内容和游标在同一个读取事务内取得，正文仍按文档读取。
- `subscribe(listener)` 接收订阅后的正式提交，返回取消订阅函数。服务在事务提交后的微任务中按提交顺序通知监听器；重试旧命令只返回回执。关闭服务或取消订阅会撤销待投递通知。
- `readChanges(cursor, limit)` 按游标分页读取已提交事件，`hasMore` 表示还有后续页。游标包含作用域、递增序号和提交标识；作品库与各作品分别计数。游标失效时返回 `snapshot-required`，调用者重新取得快照。

回执保存提交序号、标识、时间和事件描述，事件复用回执中的结果元数据。恢复旧备份后，即使重新使用同一命令和序号，也会产生新的提交标识。新命令的同内容保存仍记录提交，正文修订保持原值。

接入方先建立实时接收，再取得快照或补发记录；按作用域和游标处理重复与缺口。移动事件包含原位置和目标条目元数据，接入方据此调整两侧同级顺序。正文和恢复草稿通过对应读取接口取得。

## 存储实现

SQLite 布局、连接和事务实现见 [storage](../storage/README.md)。creation 声明仓储接口，storage 实现接口，宿主负责装配。

## 验证与依赖升级

在仓库根目录运行：

```sh
pnpm --filter @chaptale/shared build
pnpm --filter @chaptale/creation typecheck
pnpm --filter @chaptale/storage test
```

跨包集成测试位于 `packages/storage/src/__tests__`，通过公开作品接口和真实 SQLite 验证行为，覆盖重开、幂等命令、修订冲突、草稿版本、目录改名与移动、快照及事件分页。故障用例覆盖正式 COMMIT 失败、移动回执写入失败时的事务回滚，以及正式提交后草稿清理失败的恢复；事件测试还覆盖旧备份恢复、订阅取消和监听器重入。升级 better-sqlite3 或 Electron 后，重新验证目标运行时中的驱动加载、事务及关闭重开；正式作品链的打包验收在宿主接入后进行。
