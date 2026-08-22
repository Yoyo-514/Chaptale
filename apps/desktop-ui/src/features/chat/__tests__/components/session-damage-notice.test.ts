import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import SessionDamageNotice from '../../components/SessionDamageNotice.vue';

describe('SessionDamageNotice', () => {
  it('说清损坏的代价，而不只是报一个数字', () => {
    const wrapper = mount(SessionDamageNotice, { props: { damagedEntryCount: 2 } });

    expect(wrapper.text()).toContain('2 条记录损坏');
    // 作者真正需要知道的是历史缺了一段、模型也跟着失忆；只报条数等于没说。
    expect(wrapper.text()).toContain('不再显示');
    expect(wrapper.text()).toContain('模型也读不到');
  });
});
