/**
 * 消息格式
 * 使用 LangChian 内部的 Message 类，而非手动定义
 */
// export type Message = {
//   role: 'user' | 'assistant' | 'system',
//   content: string,
// };

/**
 * 非流返回的数据格式
 */
export type NonStreamResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details: {
      cached_tokens: number;
      audio_tokens: number;
    };
  };
  choices: [
    index: number,
    message: {
      role: string;
      content: string;
    },
    finish_reason: string
  ];
};
