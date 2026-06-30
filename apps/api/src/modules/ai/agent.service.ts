import { Injectable } from '@nestjs/common';
import { stepCountIs, streamText, type ModelMessage } from 'ai';

import type { ChatMessage } from '@chaptale/shared';
import { ContextService } from '../context/context.service';
import { ToolsService } from '../tools/tools.service';
import { ModelService } from './model.service';

export type StreamOptions = {
  signal: AbortSignal;
  query: string;
};

@Injectable()
export class AgentService {
  constructor(
    private readonly contextService: ContextService,
    private readonly modelService: ModelService,
    private readonly toolsService: ToolsService
  ) {}

  /**
   * 将前端展示用的 ChatMessage 转换为模型可理解的消息。
   *
   * 注意：tool_call / tool_result 目前只用于前端展示，不直接回灌到下一轮模型上下文。
   * AI SDK 在单次 streamText 调用内部会自动处理工具调用和工具结果。
   */
  private toModelMessages(messages: ChatMessage[]): ModelMessage[] {
    const modelMessages: ModelMessage[] = [];

    for (const message of messages) {
      if (message.type === 'user') {
        modelMessages.push({
          role: 'user',
          content: message.payload.content
        });
        continue;
      }

      if (message.type === 'assistant') {
        modelMessages.push({
          role: 'assistant',
          content: message.payload.content
        });
      }
    }

    return modelMessages;
  }

  async *stream(options: StreamOptions): AsyncGenerator<ChatMessage> {
    const { signal, query } = options;

    // 添加用户消息到上下文
    const userMessage: ChatMessage = {
      type: 'user',
      payload: {
        content: query
      }
    };

    this.contextService.push(userMessage);

    // 用于在流式输出结束后，将完整模型回复保存到上下文
    let assistantContent = '';

    // 启动模型流式调用。
    // systemPrompt 保留原始角色设定，chaptaleSystemPrompt 作为 Chaptale 创作能力的增量提示。
    const result = streamText({
      model: this.modelService.model,
      abortSignal: signal,
      system: [this.contextService.getSystemPrompt(), this.contextService.getChaptaleSystemPrompt()].join('\n\n'),
      messages: this.toModelMessages(this.contextService.getMessages()),
      tools: this.toolsService.tools,
      // 允许模型在一次请求中完成有限轮工具调用，避免无限循环
      stopWhen: stepCountIs(5),
      maxRetries: 3
    });

    // 观测 AI SDK 的完整事件流，并转换为前端已有的 ChatMessage 协议
    for await (const part of result.fullStream) {
      // 模型文本增量输出
      if (part.type === 'text-delta') {
        const content = part.text;
        assistantContent += content;

        yield {
          type: 'assistant',
          partial: true,
          payload: {
            content
          }
        };

        continue;
      }

      // 模型请求调用工具，通知前端展示工具调用状态
      if (part.type === 'tool-call') {
        const message: ChatMessage = {
          type: 'tool_call',
          payload: {
            id: part.toolCallId,
            name: part.toolName,
            args: part.input as Record<string, unknown>
          }
        };

        this.contextService.push(message);
        yield message;
        continue;
      }

      // 工具调用完成，通知前端展示工具结果
      if (part.type === 'tool-result') {
        const output = 'output' in part ? part.output : undefined;
        const message: ChatMessage = {
          type: 'tool_result',
          payload: {
            tool_call_id: part.toolCallId,
            name: part.toolName,
            content: JSON.stringify(output ?? null)
          }
        };

        this.contextService.push(message);
        yield message;
      }
    }

    // 保存本次模型完整回复，供后续对话继续使用
    if (assistantContent) {
      this.contextService.push({
        type: 'assistant',
        payload: {
          content: assistantContent
        }
      });
    }
  }
}
