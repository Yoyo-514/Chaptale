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
  runReview: [];
}>();
</script>

<template>
  <div class="chat-bottom-toolbar">
    <AppTooltip :text="props.isEnabledWebSearch ? '关闭联网搜索' : '开启联网搜索'" side="bottom">
      <AppButton
        variant="ghost"
        size="xs"
        type="button"
        class="chat-bottom-action"
        :selected="props.isEnabledWebSearch"
        :aria-label="props.isEnabledWebSearch ? '关闭联网搜索' : '开启联网搜索'"
        :aria-pressed="props.isEnabledWebSearch"
        @click="emit('toggleWebSearch')"
      >
        <span class="i-mingcute-earth-line size-4" aria-hidden="true" />
        <span class="chat-bottom-action-label">{{ props.isEnabledWebSearch ? '联网' : '离线' }}</span>
      </AppButton>
    </AppTooltip>
    <AppTooltip text="添加本轮上下文文件（也可直接拖入）" side="bottom">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-bottom-action"
        type="button"
        aria-label="添加上下文文件"
        @click="emit('addContextFiles')"
      >
        <span class="i-mingcute-attachment-line size-4" aria-hidden="true" />
        <span class="chat-bottom-action-label">
          {{ props.contextFileCount > 0 ? `${props.contextFileCount} 个文件` : '添加文件' }}
        </span>
      </AppButton>
    </AppTooltip>
    <AppTooltip text="对当前输入或附件的文本做三维审查" side="bottom">
      <AppButton
        variant="ghost"
        size="xs"
        class="chat-bottom-action"
        type="button"
        aria-label="三维审查"
        @click="emit('runReview')"
      >
        <span class="i-mingcute-eye-line size-4" aria-hidden="true" />
        <span class="chat-bottom-action-label">三维审查</span>
      </AppButton>
    </AppTooltip>
  </div>
</template>

<style scoped lang="scss">
.chat-bottom-toolbar {
  @apply absolute bottom-2 left-2 flex select-none items-center gap-1;
}

@container agent-panel (max-width: 20rem) {
  .chat-bottom-action {
    @apply size-6 p-0;
  }

  .chat-bottom-action-label {
    @apply hidden;
  }
}
</style>
