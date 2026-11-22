<script setup lang="ts">
import { computed } from 'vue';

import type { AppUpdate } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { renderMarkdown } from '@/utils/markdown';

const props = defineProps<{ update: AppUpdate }>();
const emit = defineEmits<{ close: [] }>();
const notes = computed(() => renderMarkdown(props.update.notes));

function openDownload() {
  // 桌面窗口把外部导航交给系统浏览器。
  window.open(props.update.downloadUrl, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <AppDialog
    :open="true"
    :title="`发现新版本 ${update.version}`"
    description="前往 GitHub 下载适用于当前系统的安装包。"
    @update:open="emit('close')"
  >
    <div class="update-notes" tabindex="0" role="region" aria-label="更新说明">
      <div v-if="notes" class="markdown-body" v-html="notes" />
      <p v-else class="update-notes-empty">此版本暂无更新说明。</p>
    </div>
    <div class="update-actions">
      <AppButton variant="primary" @click="openDownload">
        前往下载
        <span class="i-mingcute-external-link-line size-4" aria-hidden="true" />
      </AppButton>
    </div>
  </AppDialog>
</template>

<style scoped lang="scss">
.update-notes {
  @apply mt-3 min-h-0 overflow-y-auto px-2 pb-2;
  overflow-wrap: anywhere;
}
.update-notes:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.update-notes-empty {
  @apply m-0 py-2;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
}
.update-actions {
  @apply flex shrink-0 justify-end border-t pt-3;
  border-color: var(--border-subtle);
}
</style>
