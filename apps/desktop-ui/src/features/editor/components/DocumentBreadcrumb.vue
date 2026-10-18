<script setup lang="ts">
import { computed } from 'vue';

import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { useWorkbenchStore } from '@/features/workbench';
import { useFileTreeStore, useWorkspaceStore } from '@/features/workspace';

import type { DocumentHeading } from '../codemirror/markdown-navigation';
import { useEditorStore } from '../store';

const props = defineProps<{ path: string; headings: DocumentHeading[] }>();
const emit = defineEmits<{ open: []; heading: [heading: DocumentHeading] }>();

const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();

/** 作品名与各级目录点开列出该目录内容，文件名点开列出标题，与 VS Code 面包屑一致。 */
const crumbs = computed(() => {
  const parts = props.path.split('/');
  const file = parts.pop()!;
  return [
    { label: workspace.displayName ?? '作品', dir: '' },
    ...parts.map((label, index) => ({ label, dir: parts.slice(0, index + 1).join('/') })),
    { label: file, dir: undefined }
  ];
});

function load(dir: string | undefined) {
  if (dir === undefined) emit('open');
  else if (!tree.nodes[dir]) void tree.load(dir);
}

async function reveal(dir: string) {
  navigation.sidebarOpen = true;
  const parts = dir.split('/');
  for (let index = 1; index <= parts.length; index++) await tree.expand(parts.slice(0, index).join('/'));
  tree.selectedPath = dir;
}
</script>

<template>
  <nav class="document-breadcrumb" aria-label="文件路径">
    <template v-for="(crumb, index) in crumbs" :key="index">
      <span v-if="index" class="i-mingcute-right-line size-3 shrink-0" aria-hidden="true" />
      <AppDropdownMenu content-size="sm">
        <template #trigger>
          <button
            type="button"
            class="document-crumb"
            :aria-current="crumb.dir === undefined ? 'page' : undefined"
            @click="load(crumb.dir)"
          >
            {{ crumb.label }}
          </button>
        </template>
        <template v-if="crumb.dir === undefined">
          <p v-if="!headings.length" class="document-crumb-empty">没有标题</p>
          <AppDropdownMenuItem
            v-for="heading in headings"
            :key="heading.from"
            density="sm"
            :style="{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }"
            @select="emit('heading', heading)"
            >{{ heading.title }}</AppDropdownMenuItem
          >
        </template>
        <template v-else>
          <p v-if="!tree.nodes[crumb.dir]?.length" class="document-crumb-empty">
            {{ tree.loading[crumb.dir] ? '正在读取…' : '空目录' }}
          </p>
          <AppDropdownMenuItem
            v-for="entry in tree.nodes[crumb.dir]"
            :key="entry.relativePath"
            density="sm"
            item-class="document-crumb-entry"
            @select="entry.kind === 'file' ? editor.openDocument(entry.relativePath) : reveal(entry.relativePath)"
          >
            <span
              :class="entry.kind === 'file' ? 'i-mingcute-file-line' : 'i-mingcute-folder-line'"
              class="size-4 shrink-0"
              aria-hidden="true"
            />
            <span class="truncate">{{ entry.name }}</span>
          </AppDropdownMenuItem>
        </template>
      </AppDropdownMenu>
    </template>
  </nav>
</template>

<style scoped lang="scss">
.document-breadcrumb {
  @apply flex h-[22px] min-w-0 shrink-0 items-center gap-0.5 overflow-hidden px-3 whitespace-nowrap;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.document-crumb {
  @apply min-w-0 cursor-pointer truncate rounded-sm border-0 bg-transparent px-1 leading-[18px] outline-none;
  font: inherit;
  color: inherit;
}
.document-crumb:hover,
.document-crumb[data-state='open'] {
  background: var(--surface-hover);
  color: var(--foreground);
}
.document-crumb:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
}
.document-crumb[aria-current='page'] {
  @apply shrink-0;
  color: var(--foreground);
}
.document-crumb-empty {
  @apply m-0 px-2 py-1.5;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
:global(.document-crumb-entry) {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
