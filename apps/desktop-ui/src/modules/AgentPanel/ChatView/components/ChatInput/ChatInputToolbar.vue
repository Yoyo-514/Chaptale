<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

const props = defineProps<{
  isEnabledWebSearch: boolean;
  contextFileCount: number;
}>();

const emit = defineEmits<{
  toggleWebSearch: [];
  addContextFiles: [];
}>();
</script>

<template>
  <div class="chat-bottom-toolbar">
    <AppTooltip :text="props.isEnabledWebSearch ? '关闭联网搜索' : '开启联网搜索'" side="bottom">
      <AppButton
        variant="ghost"
        size="xs"
        type="button"
        :selected="props.isEnabledWebSearch"
        :aria-pressed="props.isEnabledWebSearch"
        @click="emit('toggleWebSearch')"
      >
        <span class="i-mingcute-earth-line size-4" aria-hidden="true" />
        <span>{{ props.isEnabledWebSearch ? '联网' : '离线' }}</span>
      </AppButton>
    </AppTooltip>
    <AppTooltip text="添加本轮上下文文件（也可直接拖入）" side="bottom">
      <AppButton variant="ghost" size="xs" type="button" @click="emit('addContextFiles')">
        <span class="i-mingcute-attachment-line size-4" aria-hidden="true" />
        <span>{{ props.contextFileCount > 0 ? `${props.contextFileCount} 个文件` : '添加文件' }}</span>
      </AppButton>
    </AppTooltip>
  </div>
</template>

<style scoped lang="scss">
.chat-bottom-toolbar {
  @apply absolute bottom-2 left-2 flex select-none items-center gap-1;
}
</style>
