import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PermissionRequestCard from '../components/PermissionRequestCard.vue';

function mountCard(overrides: Partial<{ toolName: string; subject: string }> = {}) {
  return mount(PermissionRequestCard, {
    props: {
      requests: [
        {
          requestId: 'permission-1',
          sessionId: 'session-1',
          toolName: overrides.toolName ?? 'write',
          riskLevel: 'mutating',
          subject: overrides.subject ?? '小说/第一章.md'
        }
      ],
      isSubmitting: false
    }
  });
}

/** 收窄按钮带动态范围后缀，工具级按钮是固定文案——两者前缀不重叠，避免误点到另一个。 */
function clickButton(wrapper: ReturnType<typeof mountCard>, label: string) {
  const button = wrapper.findAll('button').find(item => item.text().startsWith(label));
  expect(button, `未找到按钮：${label}`).toBeDefined();
  return button!.trigger('click');
}

describe('PermissionRequestCard', () => {
  it('提供参数级规则：默认授到所在目录而不是整个工具', async () => {
    // 回归：卡片此前只会生成裸工具名，参数级规则只能手写进 permissions.json。
    const wrapper = mountCard();
    await clickButton(wrapper, '始终允许');

    expect(wrapper.emitted('decide')).toEqual([
      [
        {
          requestId: 'permission-1',
          decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'write(小说/*)' }
        }
      ]
    ]);
  });

  it('仍保留放行该工具全部调用的入口', async () => {
    const wrapper = mountCard();
    await clickButton(wrapper, '本工作区始终允许');

    expect(wrapper.emitted('decide')).toEqual([
      [
        {
          requestId: 'permission-1',
          decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'write' }
        }
      ]
    ]);
  });

  it('URL 类摘要授到来源', async () => {
    const wrapper = mountCard({ toolName: 'fetch_content', subject: 'https://example.com/a/b?q=1' });
    await clickButton(wrapper, '始终允许');

    expect(wrapper.emitted('decide')?.[0]).toEqual([
      {
        requestId: 'permission-1',
        decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'fetch_content(https://example.com/*)' }
      }
    ]);
  });

  it('无摘要时只给工具级入口', () => {
    const wrapper = mountCard({ subject: '' });

    expect(wrapper.findAll('button').filter(item => item.text().startsWith('始终允许'))).toHaveLength(0);
    expect(wrapper.findAll('button').filter(item => item.text() === '本工作区始终允许')).toHaveLength(1);
  });
});
