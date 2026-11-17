import { computed, ref } from 'vue';

import { toErrorMessage } from '@/utils/desktop-api';

/** 事件与关系列表逐条保存：同一时间只执行一条命令，失败时把原因留在列表上方。 */
export function useStoryCommand(busy: () => boolean | undefined) {
  const saving = ref(false);
  const error = ref('');
  const locked = computed(() => saving.value || Boolean(busy()));
  async function run(operation: () => Promise<unknown>) {
    if (locked.value) return false;
    saving.value = true;
    error.value = '';
    try {
      await operation();
      return true;
    } catch (cause) {
      error.value = toErrorMessage(cause);
      return false;
    } finally {
      saving.value = false;
    }
  }
  return { error, locked, run };
}
