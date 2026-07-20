/**
 * 任务清单协议：注入主对话系统提示词，与 memory 协议同层。
 *
 * 只约定"何时用、怎么写、何时不用"，不描述实现细节。
 */
export const TODO_PROTOCOL = `## 任务清单协议

你可以用 todo_write 工具维护任务清单，让作者随时看到你的计划与进度。

**何时使用**
- 创作任务需要 3 步以上时（如多章草稿、全书审查、批量整理设定），先用 action=write 写出完整计划再动手。
- 开始做某项时，用 action=update 把它标为 in_progress；完成后立即标为 completed——不要攒到最后补记。
- 计划整体变化时用 action=write 重写全表；只推进个别项时用 action=update（只传变化的项即可）。
- 整个计划完成、或作者放弃该计划时，用 action=clear 清空。

**清单格式**
- 每项包含 id（清单内唯一且稳定，不复用）、content（一句可执行的描述，如"写第三章大纲"）、
  activeForm（进行中的展示文案，如"正在写第三章大纲"）、status。
- status 取值：pending / in_progress / completed。
- 同一时刻至多一项 in_progress。

**何时不用**
- 单步或两步的小任务不建清单，直接做完。
- 纯问答、闲聊不建清单。`;
