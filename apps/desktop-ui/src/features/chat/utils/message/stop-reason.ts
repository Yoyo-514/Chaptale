import type { RunStopRecordReason } from '@chaptale/ipc-contract';

/**
 * 引擎替模型收尾时对作者的解释。
 *
 * `natural` 不在表内——模型自己说完了，没什么要解释的。其余三种都是护栏动作，
 * 不说明的话作者只会看到回答毫无征兆地断在半截。
 *
 * 运行当场的通知与历史里的标记共用这一份：同一件事在两处措辞不同，
 * 只会让作者以为发生了两件事。
 */
export const STOP_REASON_NOTICES: Record<RunStopRecordReason, { title: string; description: string }> = {
  'step-limit': {
    title: '本轮已到步数上限',
    description: '连续工具调用触到单轮护栏后停下了。回复可能没写完，说一句「继续」就能接着做。'
  },
  'token-budget': {
    title: '本轮已到 token 预算上限',
    description: '累计用量触到单轮成本护栏后停下了。回复可能没写完，说一句「继续」就能接着做。'
  },
  'output-truncated': {
    title: '模型输出被长度上限截断',
    description: '这一批工具调用已整体作废，以免写进被截断的内容。把任务拆小一些再试通常就好了。'
  }
};
