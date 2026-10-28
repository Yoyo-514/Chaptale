<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { isImageFile, type Entry } from '@chaptale/creation/contracts';

import { AppDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { useCreationStore } from '@/features/creation';

/** 正文右键“插入插图…”：从资料中的图片选择，按标题与所在目录搜索。 */
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ select: [entry: Entry] }>();
const creation = useCreationStore();
const query = ref('');

function folderOf(entry: Entry) {
  const names: string[] = [];
  for (let id = entry.parentId; id;) {
    const parent = creation.entries.find(item => item.id === id)!;
    names.unshift(parent.title);
    id = parent.parentId;
  }
  return names.join(' / ') || '资料';
}
const images = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return creation.entries
    .filter(entry => entry.section === 'resource' && isImageFile(entry))
    .map(entry => ({ entry, folder: folderOf(entry) }))
    .filter(({ entry, folder }) => !keyword || `${entry.title} ${folder}`.toLowerCase().includes(keyword));
});
watch(open, value => {
  if (value) query.value = '';
});
function select(entry: Entry) {
  open.value = false;
  emit('select', entry);
}
</script>

<template>
  <AppDialog v-model:open="open" title="插入插图" content-size="sm">
    <AppInput v-model="query" aria-label="搜索图片" placeholder="搜索图片" autofocus />
    <div class="illustration-picker" role="listbox" aria-label="资料中的图片">
      <AppListItem
        v-for="{ entry, folder: path } of images"
        :key="entry.id"
        dense
        role="option"
        :title="entry.title"
        :meta="path"
        @click="select(entry)"
      >
        <template #leading><span class="i-mingcute-pic-line" aria-hidden="true" /></template>
      </AppListItem>
      <p v-if="!images.length" class="illustration-picker-empty">
        {{ query ? '没有匹配的图片' : '资料中还没有图片，可以把图片拖进正文或粘贴' }}
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.illustration-picker {
  max-height: 320px;
  margin-top: 8px;
  overflow-y: auto;
}
.illustration-picker-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--muted-foreground);
}
</style>
