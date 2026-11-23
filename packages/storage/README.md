# @chaptale/storage

Node 宿主中的 SQLite 实现，持有 schema、连接、SQL、事务和序列化。`CreationRepository` 由 creation 定义，本包实现接口；启动代码将仓储注入作品服务或作者应用入口。

```ts
import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

export async function openApplication(rootDir: string): Promise<CreationApplication> {
  return new CreationApplication(await openCreationStorage({ rootDir }));
}
```

宿主退出时调用应用的 `close()` 释放连接。桌面 worker 打包存储实现，将 better-sqlite3 原生驱动外置；桌面分发包也声明驱动运行依赖，供构建后的 worker 解析。

## 文件与事务

```text
rootDir/
  library.sqlite            作品列表、作品回收站、恢复草稿、会话查看位置、工作台状态、待接受修改与审阅记录
  works/
    <workId>/
      work.sqlite           条目、正文、修订、资料属性、事件、关系、回收站、写作要求、回执与全文索引
      vectors.sqlite        语义检索的向量，可以重建，不进作品包
      files/<entryId>/      文件条目的原文件
      history/              从作品包恢复的只读会话历史
      skills/、mcp.json     作品的 Skills 与 MCP 配置，由 agent-host 读写
    <workId>.before-import-<时间>/   覆盖导入前的作品目录快照
  sessions/<workId>/        该作品的会话历史，由 agent-host 写入，导出作品包时收集
```

会话归属由历史文件所在的 `sessions/<workId>/` 目录决定，本机库只记各作品最后查看的会话。

两种库都用 `user_version` 记录结构版本，升级时在 `SchemaPlan.migrations` 追加迁移，第 1 版的 `create` 保持不变（`src/schema.ts`）。迁移前把库复制为 `*.v<旧版本>.bak`，版本更新的库拒绝打开。`v0.2.0` 发布时本机库为第 4 版，作品库为第 2 版。

作品数据库按需打开，只缓存当前访问作品的连接，切换时关闭前一个。正文与元数据分别查询。正文、修订和回执共用作品事务；快照内容与游标共用读取事务。提交回执提供分页事件数据，作品服务在提交返回后发布通知。

草稿位于本机库，正式保存后按草稿 ID 清理；作品服务读取正式回执处理跨库清理失败后的恢复。

## 作品包

`.chaptale` 作品包是一个 SQLite 文件：作品库的副本，加上 `package_meta`（格式版本与作品信息）、`package_files`（文件条目）、`package_sessions`（会话历史）和 `package_skills`（作品 Skills）四张表，实现在 `src/work/package.ts`。向量索引和 `mcp.json` 不进包。

当前格式版本为 3，包内作品库的结构版本仍由 `user_version` 记录。导入只接受当前格式：更旧的包提示用当前版本重新导出，更新的包提示升级应用。格式 3 是随 `v0.2.0` 发布的首发格式，以后格式再变时，格式 3 及之后的包都要能继续导入。覆盖导入前把原作品目录留作 `<workId>.before-import-<时间>` 快照；包里的会话历史恢复到 `history/`，本机 `sessions/<workId>/` 已有同名历史时跳过。

## 验证

```sh
pnpm --filter @chaptale/storage typecheck
pnpm --filter @chaptale/storage test
```

集成测试通过 creation 的公开服务和应用入口操作真实临时数据库，覆盖重开、修订和草稿冲突、目录改名与移动、命令幂等、事件分页、备份恢复后的游标失效和事务故障。这些测试放在本包，creation 因此不需要依赖 storage。

真实 utilityProcess 验收使用应用的公开客户端，覆盖 Agent 与作品共用进程、保存冲突、事件、关闭重开及异常退出后的快照恢复：

```sh
pnpm --filter @chaptale/desktop build
pnpm exec playwright test --config playwright.electron.config.ts e2e/electron/application-host.spec.ts
```

升级数据库驱动或 Electron 后重跑这个用例。安装包要另外验收。
