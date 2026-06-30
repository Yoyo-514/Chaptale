import type { Request, Response } from 'express';
import express from 'express';

import { AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';

import * as agent from './agent.ts';
import { context } from './context.ts';
import { isToolCall } from './utils.ts';

// 和应用共享的类型
import type { ChatMessage } from '@chaptale/shared';

const app = express();

// 添加 JSON 请求体解析中间件
app.use(express.json());

/**
 * 历史消息查询接口
 */
app.get('/history', (_req: Request, res: Response) => {
  const messages: ChatMessage[] = [];

  // 将 LangChain 的 BaseMessage 转换成 ChatMessage
  for (const message of context) {
    if (message instanceof HumanMessage) {
      messages.push({
        type: 'user',
        payload: {
          content: message.content.toString()
        }
      });
    }

    if (message instanceof AIMessageChunk) {
      if (isToolCall(message)) {
        for (const item of message.tool_calls) {
          messages.push({
            type: 'tool_call',
            payload: {
              id: item.id!,
              name: item.name,
              args: item.args
            }
          });
        }
      } else {
        messages.push({
          type: 'assistant',
          payload: {
            content: message.content.toString()
          }
        });
      }
    }

    if (message instanceof ToolMessage) {
      messages.push({
        type: 'tool_result',
        payload: {
          tool_call_id: message.tool_call_id!,
          name: message.name!,
          content: message.content.toString()
        }
      });
    }
  }

  res.json(messages);
});

/**
 * 当前上下文查询接口
 */
app.get('/context', (_req: Request, res: Response) => {
  res.json(context);
});

/**
 * SSE 通信接口 (EventSource)
 */
app.get('/sse', sseHandler);

/**
 * SSE 通信接口（fetch）
 */
app.post('/sse', sseHandler);

async function sseHandler(req: Request, res: Response) {
  let query = '';

  if (req.method === 'GET') {
    query = req.query.query as unknown as string;
  }

  if (req.method === 'POST') {
    query = req.body.query;
  }

  const abortController = new AbortController();

  // 执行 agent
  const stream = agent.stream({
    signal: abortController.signal,
    query
  });

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 提前发送响应头
  res.flushHeaders();

  // 如果客户端断开链接，则取消模型请求
  req.on('end', () => {
    console.log('客户端连接关闭，中止请求');
    // 这会让下面的 for await 循环抛出 Error: Aborted 异常
    abortController.abort();
  });

  // 接收流式响应
  try {
    for await (const message of stream) {
      // 发送给前端
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    }
  } catch (error) {
    // 这里处理前端的主动中断动作
    console.error(error);
  }

  // 最后发送一个 close 事件，触发前端 EventSource 的自定义 close 事件
  // 该事件必须通过 EventSource.addEventListener('close') 监听
  // 必须带一个 data: ，否则前端的自定义 close 事件不会触发
  // 因为前端的自定义事件会在 message 事件触发后才触发
  res.end('event: close\ndata: \n\n');
}

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});

/**
 * 以下为 cli 模式的代码，不使用
 */
// while (true) {
//   // 读取用户输入
//   const input = await readInput();
//   messages.push(new HumanMessage(input));

//   // 调用 API 传入历史所有消息
//   const chunks = await model.stream(messages);

//   let reply = '';

//   process.stdout.write('Assistant：');

//   for await (const chunk of chunks) {
//     const content = chunk.content.toString();
//     // 打印模型回复
//     process.stdout.write(content);
//     reply += content;
//   }

//   process.stdout.write('\n\n');

//   // 保存本次模型回复
//   messages.push(new AIMessage(reply));
// }

/**
 * 读取用户输入
 */
// async function readInput() {
//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout
//   });

//   return new Promise<string>((resolve) => {
//     rl.question('User：', (message) => {
//       resolve(message);
//       rl.close();
//     });
//   });
// }

/**
 * 调用模型 API 获取回复
 * 使用 LangChain 的 stream 方法替换原来手动实现的 stream 方法
 */
// async function* stream(messages: Message[]) {
//   const res = await fetch(`${BASE_URL}/chat/completions`, {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       Authorization: `Bearer ${API_KEY}`
//     },
//     body: JSON.stringify({
//       model: MODEL,
//       messages: messages,
//       stream: true
//     })
//   });

//   if (!res.body) {
//     throw new Error('Failed to get response from API.');
//   }

//   const decoder = new TextDecoder();

//   for await (const value of res.body) {
//     const lines = decoder
//       .decode(value, { stream: true })
//       .split('\n')
//       .map((chunk) => chunk.trim())
//       .filter(Boolean);

//     for (const line of lines) {
//       if (line === 'data: [DONE]') {
//         break;
//       }

//       const json = JSON.parse(line.slice('data: '.length));
//       // 确保 choices 数组存在且有内容
//       if (json.choices && json.choices.length > 0 && json.choices[0].delta) {
//         const chunk = json.choices[0].delta.content || '';
//         if (chunk) {
//           yield chunk as string;
//         }
//       }
//     }
//   }
// }
