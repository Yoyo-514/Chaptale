<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

defineProps<{
  path: string;
  large: boolean;
  hasMetadata: boolean;
  hasTemplate: boolean;
  showForm: boolean;
  showOutline: boolean;
  dirty?: boolean;
  saving?: boolean;
}>();
const emit = defineEmits<{
  mode: [form: boolean];
  outline: [];
  metadata: [];
  reference: [];
  assets: [];
  versions: [];
  save: [];
  find: [];
  reload: [];
}>();

const tools = [
  { id: 'metadata', label: '折叠或展开元数据', icon: 'i-mingcute-braces-line' },
  { id: 'outline', label: '标题大纲', icon: 'i-mingcute-list-check-line' },
  { id: 'reference', label: '选段加入参考', icon: 'i-mingcute-bookmark-add-line' },
  { id: 'assets', label: '资产引用与提议', icon: 'i-mingcute-link-line' },
  { id: 'versions', label: '查看文档版本', icon: 'i-mingcute-history-line' }
] as const;

function selectTool(id: (typeof tools)[number]['id']) {
  if (id === 'metadata') emit('metadata');
  else if (id === 'outline') emit('outline');
  else if (id === 'reference') emit('reference');
  else if (id === 'assets') emit('assets');
  else emit('versions');
}
</script>

<template>
  <header class="document-toolbar">
    <span class="document-path" :title="path">{{ path }}</span>
    <TabsRoot
      v-if="hasTemplate && !large"
      :model-value="showForm ? 'form' : 'source'"
      @update:model-value="emit('mode', $event === 'form')"
    >
      <TabsList class="document-modes" aria-label="文档视图">
        <TabsTrigger value="form" class="document-mode" aria-controls="document-form-panel">表单</TabsTrigger>
        <TabsTrigger value="source" class="document-mode" aria-controls="document-source-panel">源文件</TabsTrigger>
      </TabsList>
    </TabsRoot>
    <template v-if="!large">
      <template v-for="tool in tools" :key="tool.id">
        <AppTooltip v-if="tool.id !== 'metadata' || hasMetadata" :text="tool.label">
          <AppButton
            icon
            size="xs"
            variant="ghost"
            :aria-label="tool.label"
            :aria-pressed="tool.id === 'outline' ? showOutline : undefined"
            @click="selectTool(tool.id)"
          >
            <span :class="tool.icon" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </template>
    </template>
    <span v-if="large" class="document-readonly"> <span class="i-mingcute-lock-line" aria-hidden="true" />只读 </span>
    <span v-else class="document-readonly" role="status">{{ saving ? '正在保存' : dirty ? '未保存' : '已保存' }}</span>
    <AppTooltip v-if="!large" text="保存文件">
      <AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="保存文件"
        :disabled="!dirty || saving"
        @click="emit('save')"
      >
        <span class="i-mingcute-save-line" aria-hidden="true" />
      </AppButton>
    </AppTooltip>
    <AppTooltip text="在文档中查找">
      <AppButton icon size="xs" variant="ghost" aria-label="在文档中查找" @click="emit('find')">
        <span class="i-mingcute-search-line" aria-hidden="true" />
      </AppButton>
    </AppTooltip>
    <AppTooltip text="重新读取">
      <AppButton icon size="xs" variant="ghost" aria-label="重新读取" @click="emit('reload')">
        <span class="i-mingcute-refresh-3-line" aria-hidden="true" />
      </AppButton>
    </AppTooltip>
  </header>
</template>

<style scoped lang="scss">
.document-toolbar {
  @apply flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b px-2;
  font-size: var(--ui-font-size);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}
.document-path {
  @apply min-w-0 flex-1 truncate pl-2;
}
.document-readonly {
  @apply mr-1 inline-flex shrink-0 items-center gap-1 text-xs;
}
.document-modes {
  @apply flex shrink-0 items-center gap-1;
}
.document-mode {
  @apply min-h-7 border-0 bg-transparent px-2 text-xs;
  color: var(--muted-foreground);
  border-radius: var(--radius-control-sm);
}
.document-mode[data-state='active'] {
  background: var(--secondary);
  color: var(--secondary-foreground);
}
</style>
