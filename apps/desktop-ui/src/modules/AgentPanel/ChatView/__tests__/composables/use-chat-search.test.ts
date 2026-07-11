import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import type { ChatDisplayMessage } from '../../types';
import { useChatSearch } from '../../composables/useChatSearch';

function createMessages(): ChatDisplayMessage[] {
  return [
    { id: 'm1', message: { role: 'user', content: '给我写一段开场白' } },
    { id: 'm2', message: { role: 'assistant', content: [{ type: 'text', text: '好的，开场白如下……' }] } },
    { id: 'm3', message: { role: 'user', content: '再改得悬疑一点' } },
    { id: 'm4', message: { role: 'assistant', content: [{ type: 'text', text: '悬疑版开场白……' }] } }
  ];
}

describe('useChatSearch', () => {
  it('matches messages by plain text and cycles through results', async () => {
    const search = useChatSearch(createMessages);

    search.open();
    search.query.value = '开场白';
    await nextTick();

    expect(search.matches.value.map(match => match.id)).toEqual(['m1', 'm2', 'm4']);
    expect(search.activeMatch.value?.id).toBe('m1');

    search.goToNext();
    expect(search.activeMatch.value?.id).toBe('m2');
    search.goToNext();
    search.goToNext();
    expect(search.activeMatch.value?.id).toBe('m1');

    search.goToPrevious();
    expect(search.activeMatch.value?.id).toBe('m4');
  });

  it('resets the active match when the query changes and clears on close', async () => {
    const search = useChatSearch(createMessages);

    search.open();
    search.query.value = '开场白';
    await nextTick();
    search.goToNext();
    expect(search.activeMatchIndex.value).toBe(1);

    search.query.value = '悬疑';
    await nextTick();
    expect(search.activeMatchIndex.value).toBe(0);
    expect(search.matches.value.map(match => match.id)).toEqual(['m3', 'm4']);

    search.close();
    expect(search.isOpen.value).toBe(false);
    expect(search.query.value).toBe('');
    expect(search.matches.value).toHaveLength(0);
  });

  it('identifies tool call and result matches with their execution section', async () => {
    const search = useChatSearch(() => [
      {
        id: 'assistant-tools',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '准备修改文件' },
            { type: 'toolCall', id: 'call-1', name: 'edit', arguments: { path: 'src/example.ts' } },
            { type: 'toolCall', id: 'call-2', name: 'read', arguments: { path: 'package.json' } }
          ]
        }
      },
      {
        id: 'result-1',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'edit',
          content: [{ type: 'text', text: 'Successfully replaced content' }]
        }
      }
    ]);

    search.query.value = 'example.ts';
    await nextTick();
    expect(search.matches.value).toEqual([
      { id: 'assistant-tools', index: 0, toolTarget: { callId: 'call-1', section: 'call' } }
    ]);

    search.query.value = 'successfully';
    await nextTick();
    expect(search.matches.value).toEqual([
      { id: 'result-1', index: 1, toolTarget: { callId: 'call-1', section: 'result' } }
    ]);

    search.query.value = '准备修改';
    await nextTick();
    expect(search.matches.value).toEqual([{ id: 'assistant-tools', index: 0 }]);
  });

  it('returns no matches for blank queries', async () => {
    const search = useChatSearch(createMessages);

    search.open();
    search.query.value = '   ';
    await nextTick();

    expect(search.matches.value).toHaveLength(0);
    expect(search.activeMatch.value).toBeUndefined();
  });
});
