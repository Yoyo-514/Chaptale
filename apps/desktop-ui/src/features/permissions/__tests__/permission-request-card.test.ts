import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { PermissionAskEvent } from '@chaptale/ipc-contract';

import PermissionRequestCard from '../components/PermissionRequestCard.vue';

function mountCard(overrides: Partial<PermissionAskEvent> = {}) {
  return mount(PermissionRequestCard, {
    props: {
      requests: [
        {
          requestId: 'permission-1',
          sessionId: 'session-1',
          toolName: 'write',
          riskLevel: 'mutating',
          subject: '小说/第一章.md',
          ...overrides
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
    // 只生成裸工具名的话，参数级规则就只能手写进 permissions.json。
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
    await clickButton(wrapper, '本作品始终允许');

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
    expect(wrapper.findAll('button').filter(item => item.text() === '本作品始终允许')).toHaveLength(1);
  });

  it('作品外读取只能授到本会话或本机全局，不提供作品级入口', async () => {
    const wrapper = mountCard({ toolName: 'external_read', riskLevel: 'sensitive', subject: 'E:/资料/设定.md' });

    expect(wrapper.text()).toContain('请求读取作品外路径');
    expect(wrapper.text()).toContain('敏感');
    // 作品级规则随作品流转，主进程也不会让它放行作品外路径。
    expect(wrapper.findAll('button').filter(item => item.text() === '本作品始终允许')).toHaveLength(0);

    await clickButton(wrapper, '本会话允许');
    await clickButton(wrapper, '始终允许');

    expect(wrapper.emitted('decide')).toEqual([
      [
        {
          requestId: 'permission-1',
          decision: { outcome: 'allow-always', scope: 'session', pattern: 'external_read(E:/资料/*)' }
        }
      ],
      [
        {
          requestId: 'permission-1',
          decision: { outcome: 'allow-always', scope: 'global', pattern: 'external_read(E:/资料/*)' }
        }
      ]
    ]);
  });

  it('委派子任务的请求注明来自哪个子任务', () => {
    const wrapper = mountCard({
      toolName: 'external_write',
      riskLevel: 'mutating',
      subject: 'E:/导出/摘要.md',
      requester: '资料专员'
    });

    expect(wrapper.text()).toContain('请求写入作品外路径');
    expect(wrapper.text()).toContain('来自子任务「资料专员」');
  });
});
