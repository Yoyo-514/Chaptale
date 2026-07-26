import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PermissionRequestCard from '../components/PermissionRequestCard.vue';

describe('PermissionRequestCard', () => {
  it('creates a workspace-wide rule for the tool rather than the current subject', async () => {
    const wrapper = mount(PermissionRequestCard, {
      props: {
        requests: [
          {
            requestId: 'permission-1',
            sessionId: 'session-1',
            toolName: 'write',
            riskLevel: 'mutating',
            subject: 'src/example.ts'
          }
        ],
        isSubmitting: false
      }
    });

    const allowAlwaysButton = wrapper.findAll('button').find(button => button.text() === '本工作区始终允许');
    expect(allowAlwaysButton).toBeDefined();
    await allowAlwaysButton?.trigger('click');

    expect(wrapper.emitted('decide')).toEqual([
      [
        {
          requestId: 'permission-1',
          decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'write' }
        }
      ]
    ]);
  });
});
