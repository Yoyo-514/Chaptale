import {
  compact,
  convertToLlm,
  type ExtensionFactory,
  type ModelRuntime,
  type SessionManager,
  serializeConversation,
  type SettingsManager
} from '@earendil-works/pi-coding-agent';

/** pi 的总结格式面向编程任务，这里只说明各节在创作中记什么。 */
export const writingCompactionInstructions = `这是小说或剧本的创作会话。沿用上面的格式，各节按创作理解：
- Goal：本次创作目标。
- Progress：剧情进度，写到哪章哪场，下一段要写什么。
- Key Decisions：新定或改动的设定；作者认可和否决的文风、要求或禁止的用词。
- Critical Context：人物当前状态、关系变化和新出现的人物；已埋下和尚未回收的伏笔。对话里交代了故事内的时间（日期、季节、事件先后）时，按故事内的时间顺序记录事件；没交代的不推测。
不要复制正文，只记文件路径和章节位置。用作者使用的语言写总结。`;

const cjkPattern = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/gu;

/** 文本中中日韩字符的占比，空文本为 0。 */
export function cjkRatio(text: string): number {
  const visible = text.replace(/\s/gu, '');
  return visible ? (visible.match(cjkPattern)?.length ?? 0) / visible.length : 0;
}

/**
 * pi 按“字符数 ÷ 4”估算 token，中文约一字一 token，会低估约 4 倍。
 * 按中文占比 r 把保留量除以 1 + 3r：纯英文不变，纯中文为四分之一。
 */
export function writingKeepRecentTokens(keepRecentTokens: number, ratio: number): number {
  return Math.floor(keepRecentTokens / (1 + 3 * ratio));
}

/**
 * 写作场景的压缩：切分、调用与记录仍由 pi 完成。
 * 保留量随当前对话的中文占比调小；总结通过 pi 的 `compact()` 生成，只追加写作向要求。
 */
export function writingCompaction(
  settingsManager: SettingsManager,
  sessionManager: SessionManager,
  modelRuntime: ModelRuntime
): ExtensionFactory {
  // pi 每次压缩前从这里读取保留量，再由原生 prepareCompaction 切分。
  const readSettings = settingsManager.getCompactionSettings.bind(settingsManager);
  settingsManager.getCompactionSettings = model => {
    const settings = readSettings(model);
    const text = serializeConversation(convertToLlm(sessionManager.buildSessionContext().messages));
    return { ...settings, keepRecentTokens: writingKeepRecentTokens(settings.keepRecentTokens, cjkRatio(text)) };
  };

  return pi => {
    pi.on('session_before_compact', async (event, ctx) => {
      const instructions = [writingCompactionInstructions, event.customInstructions].filter(Boolean).join('\n\n');
      // pi 只在已选模型时发起压缩；凭据由模型运行时按请求解析。
      const compaction = await compact(
        event.preparation,
        ctx.model!,
        undefined,
        undefined,
        instructions,
        event.signal,
        ctx.thinkingLevel,
        modelRuntime.streamSimple.bind(modelRuntime),
        undefined,
        settingsManager.getRetrySettings()
      );
      return { compaction };
    });
  };
}
