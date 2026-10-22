# @chaptale/creation

供 Node 宿主使用的作品业务包，负责作品、文稿与资料条目、修订和恢复草稿。当前通过真实 SQLite 的公共接口测试及 Electron renderer API 验收；新工作台继续按 A 批推进。

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

`CreationApplication` 接收宿主注入的仓储，`execute(command)` 异步处理作者请求，包括文件交换；`executeAuthor(command)` 提供同步的作品数据库操作。两者均校验方法和业务参数。请求成功返回 `{ ok: true, value }`；修订、草稿和位置冲突返回可序列化的错误字段，便于界面保留输入并处理冲突。非法输入返回 `invalid-request`。

作者身份固定在这个入口，宿主应从受信任的作者通道调用；请求体只允许业务参数。`subscribe` 和 `close` 分别转发已提交事件、释放存储。桌面通过 `DesktopApplicationProcess.creation` 调用真实 utilityProcess 中的入口，与 Agent 共用一个进程，分别收发命令和事件。存储目录由启动代码传入；关闭进程时等待已接收的作品请求结束，再释放 Agent 和作品库。Renderer 通过 `window.chaptaleDesktop.creation` 请求、订阅提交事件和接收断线通知。IPC 复用桌面来源校验，业务参数由作者入口校验，冲突结果作为普通数据返回。断线后调用方重新读取快照，写入请求保持原 commandId 以便核对回执。

桌面桥接类型从 `@chaptale/desktop/bridge` 导入；该入口只有类型声明。完整链路测试位于 `e2e/electron/creation-bridge.spec.ts`，覆盖保存与重启、冲突、取消订阅、拒绝无效输入及非可信页面、断线后继续订阅。

## 当前接口与保存规则

- `createWork` / `listWorks`：创建作品、读取作品列表。
- `createEntry` / `listEntries`：创建文稿或资料目录及文档，读取条目元数据；`readDocument` 按需读取正文。
- `renameDirectory`：按期望修订改名，保留目录身份和子项；同名保存保留原修订。
- `moveEntry`：在当前文稿或资料区域内排序、跨目录移动，目录连同子项保持原身份和内部层级。
- `saveDocument` / `readRevision`：按期望修订保存、读取不可变修订快照。标题、格式和正文均相同时保留原修订。
- `writeDraft` / `readDraftState` / `discardDraft`：按草稿版本写入、恢复或丢弃输入。清理正文后保留版本标记，拒绝迟到写入。

创建、改名、移动与正式保存使用 `commandId`。相同命令和参数重试返回原结果，同 ID 改参数时报错。文稿内容、修订与命令回执在同一作品数据库事务中提交。

草稿快照的 `id` 作为该快照正式保存时的 `commandId`。正式保存按 ID 清理对应草稿；读取草稿时按作品库回执核对已提交快照，处理正式提交成功、草稿清理失败后的恢复。修订冲突与草稿冲突分别使用 `RevisionConflictError`、`DraftConflictError`，纯数据错误类型见 `/contracts`。

## 会话归属与查看位置

`readSessionState` 返回会话归属及各范围最后选中的原生会话 ID；`assignSession` 将独立会话固定归入作品，重复归入同一作品返回原状态；`selectSession` 分别记录每部作品及独立范围的选择，`sessionId: null` 表示新会话草稿。归属和选择保存在本机作品库，正文、指令与运行状态仍由 pi 原生会话持有。

桌面新建会话默认归属当前作品，“更多会话操作 → 新建独立会话”创建独立会话。“全部历史”按当前作品与独立会话分组，独立历史可确认归入当前作品。作品归属使用稳定作品 ID；工作目录只决定工具执行位置。切换作品恢复该作品最后查看的会话，其他会话继续运行。只读历史使用原生会话 ID 记录归属，当前打开实例的操作句柄单独生成。

## TXT / Markdown 文件交换

文件 IO 在业务进程中异步执行，正文逐文档读取；Electron 只提供受信任的 `creation.selectPaths` 系统选择器。业务接口沿用 `creation.request`：

- `prepareImport({ paths })`：读取文件／目录元数据，返回导入计划、层级、格式和跳过的路径。目录内按中文自然顺序排列，根项沿用选择顺序；支持 `.txt`、`.md`、`.markdown`，其他文件和符号链接列入跳过清单。预览保持作品库原样。
- `importFiles({ ...plan, workId, parentId, section })`：按计划逐项提交，文件名作为独立标题，UTF-8 正文保留 BOM、frontmatter、换行及空白。编码错误和读取失败返回已完成条目及失败位置；重试沿用原计划和 commandId，通过逐项回执避免重复创建。每个条目单独提交，调用方需检查返回值中的 `failure`。
- `exportFiles({ workId, directory, target })`：`document` 将单份文稿或资料导出到所选目录；`manuscript` 保留卷及嵌套目录层级，按目录顺序分别导出文稿；`book` 按同一顺序合并整本 TXT，并加入各级目录与章节标题。前两种指定 `txt` 或 `markdown`。文档标题放在正文前，Markdown 标题使用一级标题，正文原字符保留。导出固定开始时的目录结构、名称与修订，期间改名和保存的新内容留给下次导出。

导出目录名与文件名将 Windows 禁用字符替换为 `_`，保留设备名加 `_` 前缀，去掉末尾空格与句点；清理后为空则报告失败。重名加 ` (2)`、` (3)` 后缀，通过独占创建保留既有文件与目录。已有同名目录另起编号，本次导出的子项归入新目录。`paths` 记录实际完成的文件路径；失败返回已完成路径与失败对象，目录创建失败时 `documentId` 为 `null`。当前文件的普通 IO 失败会关闭并移除本次创建的未完成文件。导出目录由调用方明确选择，重复导出生成新的文件与目录。

桌面通过作品栏“作品操作 → 导出正文…”选择范围、格式与目标目录。导出前确认未保存修改；取消确认时保持当前选择，保存后继续使用已提交内容。失败时展示具体原因和已完成路径，保留范围、格式与目标位置，用户可调整后再次导出。

宿主正常关闭等待文件交换完成。进程被强制终止时，调用方按结果未知处理：导入可用原计划核对回执，导出先核对目标目录。新工作台的导入预览、结果展示和系统选择器人工验收随界面交付。

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
pnpm --filter @chaptale/creation typecheck
pnpm --filter @chaptale/storage test
```

跨包集成测试位于 `packages/storage/src/__tests__`，通过公开作品接口和真实 SQLite 验证行为，覆盖重开、幂等命令、修订冲突、草稿版本、目录改名与移动、快照及事件分页。故障用例覆盖正式 COMMIT 失败、移动回执写入失败时的事务回滚，以及正式提交后草稿清理失败的恢复；事件测试还覆盖旧备份恢复、订阅取消和监听器重入。升级 better-sqlite3 或 Electron 后，重新验证目标运行时中的驱动加载、事务及关闭重开；完整写作流程与安装包验收随工作台交付进行。
