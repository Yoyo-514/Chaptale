import { useKeyPress, useMount, useReactive } from 'ahooks';
import { ArrowRightIcon, GlobeIcon, Loader2Icon, SquareIcon } from 'lucide-react';
import { useRef } from 'react';

import type { ChatMessage } from '@chaptale/shared';
import { MessageItem } from './components/MessageItem';
import { ssePost } from './lib/sse';
import { cn } from './lib/utils';

import styles from './App.module.scss';

function App() {
  const state = useReactive({
    messages: [] as ChatMessage[],
    input: '',
    isConnecting: false,
    isReplying: false,
    isEnabledWebSearch: true,
    error: ''
  });

  const input = useRef<HTMLInputElement>(null);
  const abortController = useRef<AbortController | null>(null);

  // 监听输入框的回车事件
  useKeyPress('Enter', handleSend, { target: input });

  /**
   * 加载历史消息
   */
  useMount(async () => {
    const response = await fetch('/api/history');
    const messages = await response.json().catch(() => []);
    state.messages = messages;

    setTimeout(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
    });
  });

  /**
   * 发送消息
   */
  async function handleSend() {
    if (state.isConnecting) return;

    // 正在回复时再次点击按钮则中断流
    if (state.isReplying) {
      abortController.current?.abort();
      return;
    }

    if (state.input.trim() === '') {
      input.current?.focus();
      return;
    }

    try {
      state.isConnecting = true;
      state.error = '';

      abortController.current = new AbortController();

      // 创建 SSE 连接（EventSource)
      // const stream = await sse<ChatMessage>('/api/sse', {
      //   signal: abortController.current.signal,
      //   params: {
      //     query: state.input.trim()
      //   }
      // });

      // 创建 SSE 链接（Fetch)
      const stream = await ssePost<ChatMessage>('/api/sse', {
        signal: abortController.current.signal,
        params: {
          query: state.input.trim()
          // websearch: state.isEnabledWebSearch
        }
      });

      state.messages.push({
        type: 'user',
        payload: {
          content: state.input
        }
      });

      state.input = '';
      state.isReplying = true;
      state.isConnecting = false;

      // 接收 SSE 消息
      for await (const message of stream) {
        const lastMessage = state.messages[state.messages.length - 1];

        // 合并不完全消息
        if (message.partial && lastMessage?.partial) {
          lastMessage.payload.content += message.payload.content;
          continue;
        }

        // 其他类型的消息
        state.messages.push(message);
      }

      state.isReplying = false;
    } catch (error: any) {
      state.error = error.message;
    } finally {
      state.isReplying = false;
      state.isConnecting = false;
    }
  }

  const isWelcome = state.messages.length === 0;

  return (
    <main className={cn(styles.main, isWelcome && styles.mainWelcome)}>
      {/* 标题 */}
      <section className={styles.header}>
        <h1 className={styles.title}>{isWelcome ? '开始构思你的故事' : 'Chaptale'}</h1>
      </section>

      {/* 聊天消息 */}
      <section className={styles.messagesSection}>
        <div className={styles.messagesList}>
          {state.messages.map((message, index) => (
            <MessageItem key={index} message={message} />
          ))}
        </div>
        {/* 错误提示 */}
        {state.error && <div className={styles.errorMessage}>{state.error}</div>}
      </section>

      {/* 底部输入框 */}
      <section className={cn(styles.inputSection, isWelcome ? styles.inputSectionWelcome : styles.inputSectionFixed)}>
        <div className={cn(styles.inputContainer)}>
          <input
            ref={input}
            className={styles.inputField}
            autoFocus
            value={state.input}
            onChange={e => (state.input = e.target.value)}
            disabled={state.isConnecting || state.isReplying}
            placeholder='输入灵感、设定或剧情片段'
          />
          <div className={styles.bottomToolbar}>
            <div className={cn(styles.websearchButton, state.isEnabledWebSearch && styles.websearchButtonActive)}>
              <GlobeIcon size={16} />
              <span>联网搜索</span>
            </div>
          </div>

          <div className={cn(styles.sendButtonWrapper)}>
            <div
              className={cn(styles.sendButton, state.isConnecting && styles.sendButtonDisabled)}
              onClick={handleSend}
            >
              {/* 正在连接图标 */}
              {state.isConnecting && <Loader2Icon size={16} className={styles.iconSpin} />}
              {/* 中断图标 */}
              {state.isReplying && <SquareIcon size={16} />}
              {/* 发送图标 */}
              {!state.isConnecting && !state.isReplying && <ArrowRightIcon size={16} className={styles.iconRotate} />}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
