# @chaptale/storage

Node 宿主中的 SQLite 实现，持有 schema、连接、SQL、事务和序列化。`CreationRepository` 由 creation 定义，本包实现接口；启动代码将仓储注入作品服务或作者应用入口。

```ts
import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

export async function openApplication(rootDir: string): Promise<CreationApplication> {
  return new CreationApplication(await openCreationStorage({ rootDir }));
}
```

宿主退出时调用应用的 `close()` 释放连接。

## 文件与事务

```text
rootDir/
  library.sqlite       作品列表、恢复草稿与作品创建回执
  works/
    <workId>.sqlite    条目、正文、修订与命令回执
```

作品数据库按需打开，只缓存当前访问作品的连接，切换时关闭前一个。正文与元数据分别查询。正文、修订和回执共用作品事务；快照内容与游标共用读取事务。提交回执提供分页事件数据，作品服务在提交返回后发布通知。

草稿位于本机库，正式保存后按草稿 ID 清理；作品服务读取正式回执处理跨库清理失败后的恢复。

## 验证

```sh
pnpm --filter @chaptale/storage typecheck
pnpm --filter @chaptale/storage test
```

集成测试通过 creation 的公开服务和应用入口操作真实临时数据库，覆盖重开、修订和草稿冲突、目录改名与移动、命令幂等、事件分页、备份恢复后的游标失效和事务故障。测试随存储实现归包，creation 的生产依赖保持单向。

升级驱动或 Electron 后，另在真实 utilityProcess 中检查驱动加载、事务和关闭重开。
