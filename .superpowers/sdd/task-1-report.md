# Task 1 Report

## 状态
- 已完成代码实现并提交：`73db95e` (`fix: bind agent sessions to workspace context`)
- 未暂存或修改 `docs/**`、`design-docs/**`、`.husky/pre-commit`
- 工作区剩余未跟踪项：`docs/`（未触碰）

## 实现内容
1. 新增 `SessionCtx` / `BoundSession<TSession>`，把历史会话的 `sessionId`、`cwd`、`scope` 作为安全上下文显式传递。
2. `PiAgentSessionFactory.create()` 不再返回裸 `AgentSession`，而是返回绑定后的 `{ session, ctx }`。
3. `ctx` 由持久化 session 元数据恢复：
   - `cwd` 直接取历史 session 的 `target.cwd`
   - `scope` 由 `path.dirname(target.path)` 经 `getSessionScope()` 解析
   - 缺失 `cwd` 时继续拒绝恢复
4. chat 会话的 persona、skills、工具白名单、权限闸门、compact 扩展全部改为使用 `ctx.cwd`，避免回退到 UI 当前 workspace。
5. `PiAgentService` 的 chat session cache 改为缓存 `Promise<BoundSession<AgentSession>>`。
6. `stream()` / `prepareSession()` 解构绑定结果后，memory 注入改为：`resolvePrefix(sessionId, ctx.cwd)`；该调用链不再读取 `settingsService.getCurrentCwd()`。
7. 补齐测试：
   - `session-factory.test.ts` 验证 chat session 返回绑定结果，且 workspace scope/cwd 来自历史 session
   - `pi-agent.service.test.ts` 验证跨 workspace 时 memory 注入使用历史 session 的 workspace，而不是 UI 当前 workspace
   - 兼容更新后的 bound session 形态，修正相关测试夹具

## 修改文件
- `apps/desktop/src/main/modules/session-ctx/types.ts`
- `apps/desktop/src/main/integrations/pi/agent/session-factory.ts`
- `apps/desktop/src/main/integrations/pi/agent/service.ts`
- `apps/desktop/src/main/integrations/pi/agent/__tests__/session-factory.test.ts`
- `apps/desktop/src/main/integrations/pi/agent/__tests__/pi-agent.service.test.ts`

## TDD 证据
### RED
命令：
```bash
pnpm exec vitest run --config vitest.config.ts --project desktop \
  apps/desktop/src/main/integrations/pi/agent/__tests__/session-factory.test.ts \
  apps/desktop/src/main/integrations/pi/agent/__tests__/pi-agent.service.test.ts
```
结果：`exit=1`
关键失败证据：
- `session-factory.test.ts`：`bound.ctx` 为 `undefined`，说明工厂仍返回裸 `AgentSession`
- `pi-agent.service.test.ts`：chat session 接口变化后，多处因仍按裸 `AgentSession` 使用而失败；根因指向 service/factory 尚未完成 bound session 接线

### GREEN
同一聚焦命令结果：`exit=0`，`Test Files 2 passed`，`Tests 33 passed`

## 测试命令与结果
1. 聚焦测试
```bash
pnpm exec vitest run --config vitest.config.ts --project desktop \
  apps/desktop/src/main/integrations/pi/agent/__tests__/session-factory.test.ts \
  apps/desktop/src/main/integrations/pi/agent/__tests__/pi-agent.service.test.ts
```
结果：`exit=0`，`Test Files 2 passed (2)`，`Tests 33 passed (33)`

2. Agent/Main + memory 回归
```bash
pnpm exec vitest run --config vitest.config.ts --project desktop \
  apps/desktop/src/main/integrations/pi/agent/__tests__ \
  apps/desktop/src/main/modules/memory/__tests__
```
结果：`exit=0`，`Test Files 15 passed (15)`，`Tests 102 passed (102)`

## 自审
- 安全不变量保持成立：历史 session 的 persona、skills、tools、memory、compact 全部以 session cwd 为准，没有回退 UI 当前 workspace。
- `systemPrompt` 分层逻辑未改，仍由 `composeSystemPrompt()` 原路径生成，保持 cache-safe。
- `createTaskSession()` 保持返回裸 `AgentSession`，没有扩大任务范围。
- `modules/session-ctx/**` 未导入 Pi SDK 或 `integrations/**`。
- 未触碰权限、pending、ToolCatalog、目录迁移逻辑。
- 本次提交过程中 pre-commit 仅对已暂存文件执行 `oxfmt` / `oxlint --fix`，之后已重新运行测试确认结果仍为绿色。

## 审查修复
- 修复内容：在 `apps/desktop/src/main/integrations/pi/agent/__tests__/session-factory.test.ts` 新增聚焦用例，场景为会话文件位于 `sessions/global/`，断言 `factory.create('session-1')` 返回的 `bound.ctx.sessionId === 'session-1'`、`bound.ctx.cwd` 保持历史会话 cwd，且 `bound.ctx.scope === 'global'`。
- 测试命令：`pnpm exec vitest run --config vitest.config.ts --project desktop apps/desktop/src/main/integrations/pi/agent/__tests__/session-factory.test.ts`
- 测试结果：`Test Files 1 passed (1)`，`Tests 9 passed (9)`，输出干净。
