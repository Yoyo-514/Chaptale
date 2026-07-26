import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 列出 pending 提议：无参数。 */
export const MemoryListPendingArgsSchema = Type.Tuple([]);
export const MemoryListPendingArgsValidator = Compile(MemoryListPendingArgsSchema);

/** 处理提议：id + accept/reject。 */
export const MemoryResolvePendingArgsSchema = Type.Tuple([
  Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      action: Type.Union([Type.Literal('accept'), Type.Literal('reject')])
    },
    { additionalProperties: false }
  )
]);
export const MemoryResolvePendingArgsValidator = Compile(MemoryResolvePendingArgsSchema);

/** pendingChanged 是无 payload 通知：仅接受 undefined/null，拒绝任何携带数据的伪装事件。 */
export const MemoryPendingChangedEventSchema = Type.Union([Type.Undefined(), Type.Null()]);
export const MemoryPendingChangedEventValidator = Compile(MemoryPendingChangedEventSchema);
