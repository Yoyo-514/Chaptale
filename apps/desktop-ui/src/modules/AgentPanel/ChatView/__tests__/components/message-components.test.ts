import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import AssistantMessage from '../../components/message/AssistantMessage.vue';
import MessageWebsearchResults from '../../components/message/MessageWebsearchResults.vue';
import ToolCallMessage from '../../components/message/ToolCallMessage.vue';
import ToolResultMessage from '../../components/message/ToolResultMessage.vue';
import UserMessage from '../../components/message/UserMessage.vue';

vi.mock('../../utils/markdown', () => ({
  renderMarkdown: (content: string) => `<p>${content}</p>`,
  renderStreamingMarkdown: (_id: string, content: string) => `<p>${content}</p>`,
  clearStreamingMarkdownCache: vi.fn()
}));

describe('chat message components', () => {
  it('edits user messages and prevents saving empty content', async () => {
    const wrapper = mount(UserMessage, { props: { content: '旧内容', editing: true } });
    const textarea = wrapper.find('textarea');

    await textarea.setValue('   ');
    await wrapper.find('form').trigger('submit');
    expect(wrapper.emitted('save')).toBeUndefined();

    await textarea.setValue('新内容');
    await wrapper.find('form').trigger('submit');
    await textarea.trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('save')).toEqual([['新内容']]);
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('renders assistant reasoning, answer markdown, and streaming indicator', async () => {
    const wrapper = mount(AssistantMessage, {
      props: {
        messageId: 'assistant-1',
        content: '**答案**',
        reasoning: '推理过程',
        reasoningStatus: 'streaming',
        partial: true
      }
    });

    expect(wrapper.text()).toContain('思考中...');
    expect(wrapper.html()).toContain('<p>**答案**</p>');
    expect(wrapper.find('.assistant-streaming-indicator').exists()).toBe(true);

    await wrapper.setProps({ partial: false, reasoningStatus: 'done' });
    expect(wrapper.text()).toContain('思考过程');
  });

  it('summarizes known tool calls from their arguments', () => {
    expect(mount(ToolCallMessage, { props: { name: 'web_search', args: { queries: ['A', 'B'] } } }).text()).toContain(
      '搜索：A / B'
    );
    expect(
      mount(ToolCallMessage, {
        props: { name: 'fetch_content', args: { urls: ['https://a.example', 'https://b.example'] } }
      }).text()
    ).toContain('读取：https://a.example / https://b.example');
    expect(
      mount(ToolCallMessage, { props: { name: 'get_search_content', args: { responseId: 'resp-1' } } }).text()
    ).toContain('取回搜索内容：resp-1');
    expect(mount(ToolCallMessage, { props: { name: 'unknown_tool', args: { ok: true } } }).text()).toContain(
      'Agent 正在调用工具'
    );
  });

  it('renders tool results including web search result cards and empty outputs', async () => {
    const webSearch = mount(ToolResultMessage, {
      props: {
        name: 'web_search',
        content: '## Results for: "agent"\n\n### Agent Docs\nhttps://example.com/docs\n\nSummary text'
      }
    });
    expect(webSearch.text()).toContain('联网搜索完成');
    expect(webSearch.text()).toContain('Agent Docs');

    const fetchContent = mount(ToolResultMessage, { props: { name: 'fetch_content', content: '{"title":"Doc"}' } });
    expect(fetchContent.text()).toContain('网页内容已读取');

    const empty = mount(ToolResultMessage, { props: { name: 'other', content: '' } });
    expect(empty.text()).toContain('工具没有返回内容');
  });

  it('expands and collapses web search citations', async () => {
    const content = [
      '## Results for: "agent"',
      '',
      ...Array.from(
        { length: 6 },
        (_, index) => `### Source ${index + 1}\nhttps://example${index + 1}.com\nDescription ${index + 1}`
      ),
      'Content fetching in background [fetch-1]. Will notify when ready.'
    ].join('\n');
    const wrapper = mount(MessageWebsearchResults, { props: { content } });

    expect(wrapper.text()).toContain('1 次查询 · 6 个来源');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(5);
    await wrapper.find('.websearch-citations-toggle').trigger('click');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(6);
    expect(wrapper.text()).toContain('Description 6');
    await wrapper.find('.websearch-citations-toggle').trigger('click');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(5);
  });
});
