import type { Request, Response } from 'express';
import express from 'express';

import type { ChatMessage } from '@chaptale/shared';
import * as agent from './agent.ts';
import { chaptaleSystemPrompt, context, systemPrompt } from './context.ts';

const app = express();

// 添加 JSON 请求体解析中间件
app.use(express.json());

/**
 * 历史消息查询接口
 */
app.get('/history', (_req: Request, res: Response) => {
  res.json(context);
});

/**
 * 当前上下文查询接口
 */
app.get('/context', (_req: Request, res: Response) => {
  res.json({
    systemPrompt,
    chaptaleSystemPrompt,
    messages: context
  });
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

  // 如果客户端断开连接，则取消模型请求
  req.on('close', () => {
    abortController.abort();
  });

  // 接收流式响应
  try {
    for await (const message of stream) {
      res.write(`data: ${JSON.stringify(message satisfies ChatMessage)}\n\n`);
    }
  } catch (error) {
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
