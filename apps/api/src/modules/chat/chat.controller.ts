import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { ChatMessage } from '@chaptale/shared';
import type { Request, Response } from 'express';

import { AgentService } from '../ai/agent.service';
import { ContextService } from '../context/context.service';

type SseBody = {
  query?: string;
};

@Controller()
export class ChatController {
  constructor(
    private readonly agentService: AgentService,
    private readonly contextService: ContextService
  ) {}

  /**
   * 历史消息查询接口
   */
  @Get('history')
  history() {
    return this.contextService.getMessages();
  }

  /**
   * 当前上下文查询接口
   */
  @Get('context')
  currentContext() {
    return {
      systemPrompt: this.contextService.getSystemPrompt(),
      chaptaleSystemPrompt: this.contextService.getChaptaleSystemPrompt(),
      messages: this.contextService.getMessages()
    };
  }

  /**
   * SSE 通信接口 (EventSource)
   */
  @Get('sse')
  async getSse(@Query('query') query: string, @Req() req: Request, @Res() res: Response) {
    await this.sseHandler(query, req, res);
  }

  /**
   * SSE 通信接口（fetch）
   */
  @Post('sse')
  async postSse(@Body() body: SseBody, @Req() req: Request, @Res() res: Response) {
    await this.sseHandler(body.query ?? '', req, res);
  }

  private async sseHandler(query: string, req: Request, res: Response) {
    const abortController = new AbortController();

    // 执行 agent
    const stream = this.agentService.stream({
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
}
