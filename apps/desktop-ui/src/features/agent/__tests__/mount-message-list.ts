import { mount, type MountingOptions } from '@vue/test-utils';

import MessageList from '../components/MessageList.vue';
import { createTranscriptMemory } from '../transcript-viewport';

type Props = InstanceType<typeof MessageList>['$props'];
type Options = Pick<MountingOptions<Props>, 'global'> & {
  props: Omit<Props, 'visible' | 'viewport' | 'memory'>;
};

export function mountMessageList({ props, ...options }: Options) {
  const viewport = document.createElement('div');
  // happy-dom 没有布局；为短会话用例提供真实虚拟列表需要的视口尺寸。
  Object.defineProperties(viewport, { clientWidth: { value: 560 }, clientHeight: { value: 4096 } });
  return mount(MessageList, {
    ...options,
    props: { ...props, visible: true, viewport, memory: createTranscriptMemory() }
  });
}
