# @chaptale/creation

供 Node 宿主使用的作品业务包，负责作品、文稿与资料条目、修订和恢复草稿。当前通过真实 SQLite 的公共接口测试验证；桌面业务进程与新工作台接入继续按 A 批推进。

## 模块与入口

| 入口                           | 内容                                     | 使用方              |
| ------------------------------ | ---------------------------------------- | ------------------- |
| `@chaptale/creation`           | `CreationService`、存储接口、业务错误    | Node 业务与启动代码 |
| `@chaptale/creation/contracts` | 作品、文稿、修订、草稿与错误的纯数据类型 | 界面、传输与业务    |
| `@chaptale/creation/storage`   | `openCreationStorage`，装配 SQLite 存储  | Node 启动代码       |

业务层通过 `CreationRepository` 访问存储；`storage/` 实现连接、SQL、事务和序列化。宿主负责确定私有目录并注入存储，Renderer 从 `/contracts` 引用类型。作品业务和存储实现都运行在 Node 中。

```ts
import { CreationService } from '@chaptale/creation';
import { openCreationStorage } from '@chaptale/creation/storage';

export async function openCreationService(rootDir: string): Promise<CreationService> {
  return new CreationService(await openCreationStorage({ rootDir }));
}
```

宿主退出时调用 `service.close()`，释放本机库和当前作品的连接。`.oxlintrc.json` 检查平台导入、业务对存储实现的直接引用及循环依赖。

## 当前接口与保存规则

- `createWork` / `listWorks`：创建作品、读取作品列表。
- `createEntry` / `listEntries`：创建文稿或资料目录及文档，读取条目元数据；`readDocument` 按需读取正文。
- `saveDocument` / `readRevision`：按期望修订保存、读取不可变修订快照。标题、格式和正文均相同时保留原修订。
- `writeDraft` / `readDraftState` / `discardDraft`：按草稿版本写入、恢复或丢弃输入。清理正文后保留版本标记，拒绝迟到写入。

创建与正式保存使用 `commandId`。相同命令和参数重试返回原结果，同 ID 改参数时报错。文稿内容、修订与命令回执在同一作品数据库事务中提交。

草稿快照的 `id` 作为该快照正式保存时的 `commandId`。正式保存按 ID 清理对应草稿；读取草稿时按作品库回执核对已提交快照，处理正式提交成功、草稿清理失败后的恢复。修订冲突与草稿冲突分别使用 `RevisionConflictError`、`DraftConflictError`，纯数据错误类型见 `/contracts`。

## 存储布局

```text
rootDir/
  library.sqlite       作品列表与恢复草稿
  works/
    <workId>.sqlite    条目、正文、修订与命令回执
```

存储按需打开作品数据库，只缓存当前访问作品的连接，切换作品时关闭前一个。正文读取与树元数据读取分开。

## 验证与依赖升级

在仓库根目录运行：

```sh
pnpm --filter @chaptale/shared build
pnpm --filter @chaptale/creation typecheck
pnpm --filter @chaptale/creation test
```

测试使用临时目录和真实 SQLite，覆盖重开、幂等命令、修订冲突、草稿版本及跨库清理失败后的恢复。升级 better-sqlite3 或 Electron 后，重新验证目标运行时中的驱动加载、事务及关闭重开；正式作品链的打包验收在宿主接入后进行。
