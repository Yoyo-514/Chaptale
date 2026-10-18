import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';

import type { AgentInstructions } from '@chaptale/agent-host/protocol';

import InstructionsEditor from '../components/InstructionsEditor.vue';

const entries: AgentInstructions = [
  { name: '协作职责', role: 'system', text: '协助作者写作。', enabled: true },
  { name: '交流方式', role: 'user', text: '简短说明修改理由。', enabled: false }
];

it('一次编辑一条指令，切换时保留未保存内容', async () => {
  const wrapper = mount(InstructionsEditor, { props: { entries, label: '保存指令' } });
  expect(wrapper.findAll('textarea')).toHaveLength(1);
  await wrapper.get('textarea').setValue('新的协作约定');
  await wrapper.get('button[aria-label="编辑交流方式"]').trigger('click');
  expect(wrapper.get('textarea').element.value).toBe('简短说明修改理由。');
  await wrapper.get('button[aria-label="编辑协作职责"]').trigger('click');
  expect(wrapper.get('textarea').element.value).toBe('新的协作约定');
});

it('保存整套指令，保留角色、顺序和启停状态', async () => {
  const wrapper = mount(InstructionsEditor, { props: { entries, label: '保存指令' } });
  await wrapper.get('textarea').setValue('新的协作约定');
  await wrapper.get('form').trigger('submit');
  expect(wrapper.emitted('save')?.[0]?.[0]).toEqual([{ ...entries[0], text: '新的协作约定' }, entries[1]]);
  expect(entries[0].text).toBe('协助作者写作。');
});

it('其他设置刷新时保留正在编辑的指令草稿', async () => {
  const wrapper = mount(InstructionsEditor, { props: { entries, label: '保存指令' } });
  await wrapper.get('textarea').setValue('尚未保存的内容');
  await wrapper.setProps({ entries: entries.map(entry => ({ ...entry })) });
  expect(wrapper.get('textarea').element.value).toBe('尚未保存的内容');
});
