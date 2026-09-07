<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';
import { AppInput } from '@/components/AppInput';
import { toErrorMessage } from '@/utils/desktop-api';

import { useEditorStore } from '../store';

const editor = useEditorStore();
const tab = computed(() => editor.conflictTab);
const copyPath = ref('');
const error = ref('');
const copying = ref(false);
watch(
  () => tab.value?.id,
  () => {
    copyPath.value = tab.value?.path.replace(/(\.[^/.]+)?$/, '-恢复副本$1') ?? '';
    error.value = '';
  },
  { immediate: true }
);
async function saveCopy() {
  if (!tab.value) return;
  copying.value = true;
  try {
    await editor.saveConflictCopy(tab.value.id, copyPath.value);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    copying.value = false;
  }
}
</script>
<template>
  <AppDialog
    :open="Boolean(tab)"
    title="磁盘版本冲突"
    :description="tab?.path"
    content-size="lg"
    @update:open="open => !open && (editor.conflictId = '')"
  >
    <div v-if="tab" class="conflict-body">
      <AppDiffView
        :original="tab.external?.ok ? tab.external.document.content : ''"
        :modified="editor.getBuffer(tab.id)?.content ?? tab.document?.content ?? ''"
        original-label="磁盘版本"
        modified-label="本地未保存版本"
      />
      <p v-if="tab.saveError || error" role="alert">{{ error || tab.saveError }}</p>
      <div class="conflict-actions">
        <AppButton size="sm" :disabled="!tab.external?.ok || tab.saving" @click="editor.acceptExternal(tab.id)"
          >接受外部</AppButton
        >
        <AppButton size="sm" :disabled="!tab.external?.ok || tab.saving" @click="editor.keepLocal(tab.id)"
          >保留我的</AppButton
        >
      </div>
      <div class="conflict-copy">
        <AppInput v-model="copyPath" aria-label="副本相对路径" />
        <AppButton size="sm" :disabled="copying || !copyPath.trim()" @click="saveCopy">另存副本</AppButton>
      </div>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.conflict-body {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  height: min(65vh, 34rem);
}
.conflict-body p {
  @apply m-0 shrink-0 text-xs;
  color: var(--destructive);
  overflow-wrap: anywhere;
}
.conflict-actions {
  @apply flex shrink-0 justify-end gap-2;
}
.conflict-copy {
  @apply flex shrink-0 items-center gap-2;
}
.conflict-copy :deep(input) {
  min-width: 0;
}
</style>
