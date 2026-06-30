import { GlobeIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';
import type { ChatMessage, WebsearchResult } from '@chaptale/shared';

import 'github-markdown-css/github-markdown.css';
import styles from './MessageItem.module.scss';

export type MessageItemProps = {
  message: ChatMessage;
};

export function MessageItem(props: MessageItemProps) {
  const { message } = props;

  const isUserMessage = message.type === 'user';

  return (
    <div className={cn(styles.messageContainer, isUserMessage && styles.messageContainerUser)}>
      {isUserMessage && <UserMessage {...message.payload} />}

      {message.type === 'assistant' && <AssistantMessage {...message.payload} />}

      {message.type === 'tool_call' && message.payload.name === 'websearch' && <ToolCallMessage {...message.payload} />}

      {message.type === 'tool_result' && <ToolResultMessage {...message.payload} />}
    </div>
  );
}

function UserMessage(props: { content: string }) {
  const { content } = props;

  return <p className={styles.userMessage}>{content}</p>;
}

function AssistantMessage(props: { content: string }) {
  const { content } = props;

  return (
    <div className='markdown-body'>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}

function ToolCallMessage(props: { id: string; name: string; args: Record<string, any> }) {
  const { name, args } = props;

  if (name === 'websearch') {
    return <WebsearchKeywordsMessage keywords={args.keywords} />;
  }

  // TODO: 其他工具调用展示

  return null;
}

function ToolResultMessage(props: { tool_call_id: string; name: string; content: string }) {
  const { name, content } = props;

  if (name === 'websearch') {
    return <WebsearchResultsMessage searchResults={JSON.parse(content) as WebsearchResult} />;
  }

  // TODO: 其他工具结果展示

  return null;
}

function WebsearchKeywordsMessage(props: { keywords: string }) {
  const { keywords } = props;

  return (
    <div className={styles.websearchKeywords}>
      <SearchIcon className={styles.websearchKeywordsIcon} size={18} />
      <span className={styles.websearchKeywordsText}>
        正在搜索：
        <span className={styles.websearchKeywordsQuery}>{keywords}</span>
      </span>
    </div>
  );
}

function WebsearchResultsMessage(props: { searchResults: WebsearchResult }) {
  const { searchResults } = props;

  const [showAll, setShowAll] = useState(false);

  const displayedResults = showAll ? searchResults : searchResults.slice(0, 5);

  return (
    <div className={styles.websearchResults}>
      {/* 结果标题 */}
      <p className={styles.websearchResultsHeader}>
        <GlobeIcon size={18} />
        已搜索 {searchResults.length} 条结果
      </p>

      {/* 结果列表 */}
      <div className={styles.resultsList}>
        {displayedResults.map((result, index) => (
          <a key={index} className={styles.resultItem} href={result.link} target='_blank'>
            <p className={styles.resultTitle}>{result.title}</p>
            <p className={styles.resultDescription}>{result.description}</p>
          </a>
        ))}
      </div>

      {/* 展开、收起 */}
      <div className={styles.toggleButton}>
        <span className={styles.toggleButtonText} onClick={() => setShowAll(!showAll)}>
          {showAll ? '收起' : '展开所有'}
        </span>
      </div>
    </div>
  );
}
