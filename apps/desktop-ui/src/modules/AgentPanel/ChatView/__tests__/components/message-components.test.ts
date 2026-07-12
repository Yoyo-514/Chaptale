import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ChatContextFiles from '../../components/ChatInput/ChatContextFiles.vue';
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
    const wrapper = mount(UserMessage, { props: { content: '旧内容', editableContent: '旧内容', editing: true } });
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

  it('renders a compact skill badge while editing the reusable slash invocation', async () => {
    const wrapper = mount(UserMessage, {
      props: {
        content: '检查第一章',
        editableContent: '/skill:review 检查第一章',
        skillInvocation: { name: 'review', arguments: '检查第一章' },
        editing: false
      }
    });

    expect(wrapper.find('.user-message-skill').text()).toBe('review');
    expect(wrapper.find('.user-message').text()).toContain('检查第一章');

    await wrapper.setProps({ editing: true });
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('/skill:review 检查第一章');
  });

  it('renders files and image previews on user messages without exposing removal controls', () => {
    const wrapper = mount(UserMessage, {
      props: {
        content: '检查附件',
        editableContent: '检查附件',
        contextFiles: [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }],
        images: [
          {
            type: 'imageAttachment',
            id: 'image-1',
            mimeType: 'image/png',
            originalBytes: 3,
            width: 100,
            height: 80,
            thumbnailDataUrl: 'data:image/png;base64,YWJj'
          }
        ]
      }
    });

    const cards = wrapper.findAll('.chat-context-file-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.text()).toContain('outline.md');
    expect(cards[0]?.attributes('title')).toBe('outline.md');
    expect(wrapper.find('.app-image-gallery-image').attributes()).toMatchObject({
      src: 'data:image/png;base64,YWJj',
      loading: 'lazy',
      decoding: 'async'
    });
    expect(wrapper.find('[aria-label="移除"]').exists()).toBe(false);
    expect(wrapper.find('.app-image-thumbnail-remove').exists()).toBe(false);
  });

  it('renders image attachments as compact tiles while file cards remain in a normal wrapping list', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      path: `C:/novel/image-${index}.png`,
      name: `image-${index}.png`,
      size: 1024,
      kind: 'image' as const,
      mimeType: 'image/png',
      previewDataUrl: `data:image/png;base64,thumb-${index}`
    }));
    const wrapper = mount(ChatContextFiles, {
      props: {
        files: [
          ...images,
          { path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' },
          { path: 'C:/novel/reference.pdf', name: 'reference.pdf', size: 4096, kind: 'document' }
        ]
      }
    });

    expect(wrapper.find('.app-image-thumbnail-grid').exists()).toBe(true);
    expect(wrapper.findAll('.app-image-thumbnail-item')).toHaveLength(9);
    expect(wrapper.findAll('.chat-context-file-card')).toHaveLength(2);
    expect(wrapper.find('.app-image-thumbnail-grid .chat-context-file-card').exists()).toBe(false);
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

  it('renders tool results including plain web search results and empty outputs', async () => {
    const webSearch = mount(ToolResultMessage, {
      props: {
        name: 'web_search',
        content: '## Results for: "agent"\n\n### Agent Docs\nhttps://example.com/docs\n\nSummary text'
      }
    });
    expect(webSearch.text()).toContain('结果 · 联网搜索');
    expect(webSearch.find('.websearch-card').exists()).toBe(false);
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

    expect(wrapper.find('.websearch-card').exists()).toBe(false);
    expect(wrapper.text()).toContain('查询：agent · 6 个来源');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(5);
    await wrapper.find('.websearch-citations-toggle').trigger('click');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(6);
    expect(wrapper.text()).toContain('Description 6');
    await wrapper.find('.websearch-citations-toggle').trigger('click');
    expect(wrapper.findAll('.websearch-citation')).toHaveLength(5);
  });
});
