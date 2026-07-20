/**
 * 任务清单协议：注入主对话系统提示词，与 memory 协议同层。
 *
 * 只约定"何时用、怎么写、何时不用"，不描述实现细节。
 */
export const TODO_PROTOCOL = `## 任务清单协议

你可以用 todo_write 工具维护任务清单，让作者随时看到你的计划与进度。

**何时使用**
- 任务需要 3 步以上时，先写出完整清单再动手。
- 每完成一项，立即把它标为 completed，并把下一项标为 in_progress。
- 计划有变时整表重写：todo_write 是整表替换语义，传入的清单会完全覆盖旧表。

**清单格式**
- 每项包含 id（清单内唯一且稳定，不复用）、content（一句可执行的描述）、status。
- status 取值：pending / in_progress / completed。
- 同一时刻至多一项 in_progress。

**何时不用**
- 单步或两步的小任务不建清单，直接做完。`;
