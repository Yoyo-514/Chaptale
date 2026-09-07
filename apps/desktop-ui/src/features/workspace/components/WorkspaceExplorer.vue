<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';

import { useFileTreeStore } from '../file-tree/store';
import { useWorkspaceStore } from '../store';
import WorkspaceCreateEntryDialog from './WorkspaceCreateEntryDialog.vue';

/** 虚拟行和 CSS 共用 28px 高度，容纳通用图标按钮；每级缩进 8px。 */
const ROW_HEIGHT = 28;
const INDENT_STEP = 8;
/** 树内容的起始内边距；缩进参考线也以它为基准。 */
const TREE_PADDING_START = 8;

const emit = defineEmits<{ openFile: [relativePath: string] }>();
const workspace = useWorkspaceStore();
const tree = useFileTreeStore();
const rows = computed(() => tree.visibleRows);
const scrollElementRef = ref<HTMLElement | null>(null);
const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getItemKey: (index: number) => rows.value[index]!.relativePath,
    getScrollElement: () => scrollElementRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  }))
);
const virtualItems = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
const tabStopPath = computed(() =>
  rows.value.some(row => row.relativePath === tree.selectedPath) ? tree.selectedPath : rows.value[0]?.relativePath
);

async function focusRow(index: number) {
  if (!rows.value[index]) return;
  virtualizer.value.scrollToIndex(index, { align: 'auto' });
  await nextTick();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await nextTick();
  scrollElementRef.value?.querySelector<HTMLElement>(`[data-tree-index="${index}"]`)?.focus();
}

/** 单击文件即打开，目录单击展开；方向键移动焦点不打开文件。 */
function activateRow(index: number, event?: MouseEvent) {
  const clickedPath = (event?.currentTarget as HTMLElement | undefined)?.dataset.treePath;
  const row = clickedPath ? rows.value.find(item => item.relativePath === clickedPath) : rows.value[index];
  if (!row) return;

  tree.selectedPath = row.relativePath;
  if (row.kind === 'directory' && (event?.detail ?? 1) < 2) void tree.toggle(row.relativePath);
  else if (row.kind === 'file' && (event?.detail ?? 1) < 2) emit('openFile', row.relativePath);
}

function openFileRow(index: number) {
  const row = rows.value[index];
  if (row?.kind === 'file') emit('openFile', row.relativePath);
}

function handleKeydown(index: number, event: KeyboardEvent) {
  const row = rows.value[index];
  if (!row) return;

  const isDirectory = row.kind === 'directory';

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    void focusRow(Math.min(index + 1, rows.value.length - 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    void focusRow(Math.max(index - 1, 0));
  } else if (event.key === 'Home') {
    event.preventDefault();
    void focusRow(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    void focusRow(rows.value.length - 1);
  } else if (event.key === 'ArrowRight' && isDirectory) {
    event.preventDefault();
    if (!row.expanded) void tree.toggle(row.relativePath);
    else if (rows.value[index + 1]?.depth === row.depth + 1) void focusRow(index + 1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (isDirectory && row.expanded) void tree.toggle(row.relativePath);
    else {
      const parent = row.relativePath.split('/').slice(0, -1).join('/');
      void focusRow(rows.value.findIndex(item => item.relativePath === parent));
    }
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (isDirectory) activateRow(index);
    else openFileRow(index);
  } else if (event.key === ' ') {
    event.preventDefault();
    activateRow(index);
  }
}

async function handleCreate(name: string) {
  const created = await tree.submitCreation(name);
  if (!created) return;

  // 新建目标在视口外时滚过去，否则「创建成功」只是个通知，看不到结果。
  const index = rows.value.findIndex(row => row.relativePath === created);
  if (index !== -1) virtualizer.value.scrollToIndex(index);
}

onMounted(async () => {
  // 严格先后：工作区状态刷新会触发下面那个 revision 监听并立即取数，
  // 先拿到「显示内部文件」偏好，首次请求才不会按默认值白拉一遍。
  await tree.loadPreferences();
  await workspace.refreshState();
  if (workspace.rootPath) await tree.load();
});

watch(
  () => workspace.revision,
  async () => {
    // 换了工作区，旧缓存与展开态全部作废。
    tree.reset();
    if (workspace.rootPath) await tree.load();
  }
);
</script>

<template>
  <div class="workspace-explorer">
    <!-- 视图标题行：管的是「这个视图怎么显示」，与针对根目录的操作分开。 -->
    <header class="workspace-explorer-header">
      <span class="workspace-explorer-title">资源管理器</span>
      <AppTooltip :text="tree.showInternalFiles ? '隐藏内部文件' : '显示内部文件'" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          :selected="tree.showInternalFiles"
          :aria-pressed="tree.showInternalFiles"
          :aria-label="tree.showInternalFiles ? '隐藏内部文件' : '显示内部文件'"
          @click="tree.setShowInternalFiles(!tree.showInternalFiles)"
        >
          <span
            :class="tree.showInternalFiles ? 'i-mingcute-eye-line' : 'i-mingcute-eye-close-line'"
            class="size-3.5"
            aria-hidden="true"
          />
        </AppButton>
      </AppTooltip>
    </header>

    <!-- 根节点行：工作区名 + 针对根目录的操作，按钮在 hover/键盘聚焦时出现。 -->
    <div v-if="workspace.rootPath" class="workspace-explorer-root">
      <span class="workspace-explorer-root-name" :title="workspace.rootPath">
        {{ workspace.displayName ?? workspace.rootPath }}
      </span>
      <div class="workspace-explorer-root-actions">
        <AppTooltip text="新建文件" side="bottom" :side-offset="3">
          <AppButton icon size="xs" variant="ghost" aria-label="新建文件" @click="tree.startCreation('file')">
            <span class="i-mingcute-file-new-line size-3.5" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
        <AppTooltip text="新建文件夹" side="bottom" :side-offset="3">
          <AppButton icon size="xs" variant="ghost" aria-label="新建文件夹" @click="tree.startCreation('directory')">
            <span class="i-mingcute-folder-open-2-line size-3.5" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
        <AppTooltip text="刷新" side="bottom" :side-offset="3">
          <AppButton icon size="xs" variant="ghost" aria-label="刷新文件树" @click="tree.reload()">
            <span class="i-mingcute-refresh-3-line size-3.5" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
        <AppTooltip text="折叠全部" side="bottom" :side-offset="3">
          <AppButton
            icon
            size="xs"
            variant="ghost"
            aria-label="折叠全部文件夹"
            :disabled="tree.expanded.size === 0"
            @click="tree.collapseAll()"
          >
            <span class="i-mingcute-list-collapse-line size-3.5" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </div>
    </div>

    <div v-if="!workspace.rootPath" class="workspace-explorer-placeholder">
      <p>尚未打开工作区</p>
      <AppButton size="sm" @click="workspace.openWorkspace">打开工作区</AppButton>
    </div>
    <!-- 占位只属于「根目录从未加载过」：刷新/显隐切换会清缓存重排（闪一下），
         不显示占位面板，与 VS Code 的刷新观感一致。 -->
    <div v-else-if="tree.loading[''] && !tree.rootLoaded" class="workspace-explorer-placeholder">
      <p>正在读取文件…</p>
    </div>
    <div v-else-if="tree.errors['']" class="workspace-explorer-placeholder">
      <p>{{ tree.errors[''] }}</p>
    </div>
    <div v-else ref="scrollElementRef" role="tree" aria-label="工作区文件树" class="workspace-tree">
      <div class="workspace-tree-spacer" :style="{ height: `${totalSize}px` }">
        <template v-for="item in virtualItems" :key="String(item.key)">
          <div
            v-if="rows[item.index]"
            :style="{
              transform: `translateY(${item.start}px)`,
              paddingInlineStart: `${TREE_PADDING_START + rows[item.index]!.depth * INDENT_STEP}px`
            }"
            :data-tree-index="item.index"
            :data-tree-path="rows[item.index]!.relativePath"
            :title="rows[item.index]!.relativePath"
            role="treeitem"
            :aria-level="rows[item.index]!.depth + 1"
            :aria-expanded="rows[item.index]!.kind === 'directory' ? rows[item.index]!.expanded : undefined"
            :aria-selected="tree.selectedPath === rows[item.index]!.relativePath"
            :aria-setsize="rows[item.index]!.setSize"
            :aria-posinset="rows[item.index]!.posInSet"
            :tabindex="tabStopPath === rows[item.index]!.relativePath ? 0 : -1"
            class="workspace-tree-row"
            :class="{ 'is-selected': tree.selectedPath === rows[item.index]!.relativePath }"
            @keydown="handleKeydown(item.index, $event)"
            @click="activateRow(item.index, $event)"
            @focus="tree.selectedPath = rows[item.index]!.relativePath"
          >
            <!-- 缩进参考线：每个祖先层级一条，对准该祖先行的箭头中心，三层以上时用来对齐父子关系。 -->
            <span
              v-for="level in rows[item.index]!.depth"
              :key="level"
              class="workspace-tree-guide"
              :style="{ left: `${TREE_PADDING_START + level * INDENT_STEP}px` }"
              aria-hidden="true"
            />
            <!-- 文件行也占掉折叠箭头的位置，否则同一层的图标列会错开。 -->
            <span class="workspace-tree-twistie" aria-hidden="true">
              <span
                v-if="rows[item.index]!.kind === 'directory'"
                class="size-3.5"
                :class="rows[item.index]!.expanded ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
              />
            </span>
            <span
              class="workspace-tree-icon"
              :class="
                rows[item.index]!.kind === 'directory'
                  ? rows[item.index]!.expanded
                    ? 'i-mingcute-folder-open-2-line'
                    : 'i-mingcute-folder-2-line'
                  : 'i-mingcute-file-line'
              "
              aria-hidden="true"
            />
            <span class="workspace-tree-label">{{ rows[item.index]!.name }}</span>
            <span
              v-if="tree.loading[rows[item.index]!.relativePath]"
              class="i-mingcute-loading-line size-3 shrink-0 animate-spin"
              aria-label="正在读取"
            />
            <span
              v-else-if="rows[item.index]!.expanded && tree.nodes[rows[item.index]!.relativePath]?.length === 0"
              class="workspace-tree-hint"
              >空</span
            >
            <AppTooltip
              v-if="tree.errors[rows[item.index]!.relativePath]"
              :text="tree.errors[rows[item.index]!.relativePath]!"
            >
              <AppButton
                icon
                size="xs"
                variant="ghost"
                :aria-label="`重新读取 ${rows[item.index]!.relativePath}`"
                @click.stop="tree.load(rows[item.index]!.relativePath)"
                @dblclick.stop
              >
                <span class="i-mingcute-warning-line size-3" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
          </div>
        </template>
      </div>
      <p v-if="tree.rootLoaded && !rows.length && !tree.loading['']" class="workspace-tree-empty">工作区为空</p>
    </div>

    <WorkspaceCreateEntryDialog
      v-if="tree.pendingCreation"
      :open="Boolean(tree.pendingCreation)"
      :kind="tree.pendingCreation.kind"
      :parent="tree.pendingCreation.parent"
      @update:open="open => !open && tree.cancelCreation()"
      @submit="handleCreate"
    />
  </div>
</template>

<style scoped lang="scss">
.workspace-explorer {
  @apply flex min-h-0 flex-1 flex-col overflow-hidden;
}

/* 侧栏标题不跟编辑器标签同高：那是给标签页留的尺寸，套在纯文字标题上会空出一大块。 */
.workspace-explorer-header {
  @apply flex h-9 shrink-0 items-center justify-between gap-1 pl-3 pr-1.5;
}

/* 标题是定位信息不是重点内容，加粗会盖过下面的工作区名。 */
.workspace-explorer-title {
  @apply truncate text-xs font-normal;

  color: var(--muted-foreground);
}

/* 根节点留出通用图标按钮的完整命中区。 */
.workspace-explorer-root {
  @apply flex h-8 shrink-0 items-center gap-1 pl-3 pr-1;
}

.workspace-explorer-root-name {
  @apply min-w-0 flex-1 truncate font-medium;
  font-size: var(--ui-font-size);

  color: var(--foreground);
}

/* 操作按钮平时让位给工作区名；指针进到侧栏或键盘进到按钮时才出现。 */
.workspace-explorer-root-actions {
  @apply flex shrink-0 items-center opacity-0;
}

.workspace-explorer:hover .workspace-explorer-root-actions,
.workspace-explorer-root-actions:focus-within {
  @apply opacity-100;
}

/* 不能复用 WorkbenchLayout 里的 .workbench-placeholder：那是 scoped 样式，选择器带着它自己的 data-v 属性，到这个组件里不会命中。 */
.workspace-explorer-placeholder {
  @apply flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center text-xs;

  color: var(--muted-foreground);
}

.workspace-tree {
  @apply min-h-0 flex-1 overflow-auto pb-2;
}

.workspace-tree-spacer {
  @apply relative w-full;
}

.workspace-tree-row {
  @apply absolute inset-x-0 top-0 flex select-none items-center gap-0.5 pr-2 outline-none;

  height: 28px;
  font-size: var(--ui-font-size);
  color: var(--foreground);
  cursor: pointer;
  /* 行背景是块状高亮，跟着 * 的 transition 淡入会拖慢指针反馈。 */
  transition: none;
}

.workspace-tree-row:hover {
  background: var(--surface-hover);
}

.workspace-tree-row.is-selected {
  background: var(--accent);
  color: var(--accent-foreground);
}

.workspace-tree-row:focus-visible {
  outline: 1px solid var(--ring);
  outline-offset: -1px;
}

/* 参考线画在行内而不是背景层：跟着虚拟行走，滚动时不会与内容错位。 */
.workspace-tree-guide {
  @apply pointer-events-none absolute inset-y-0 w-px;

  background: var(--border-subtle);
}

/* 箭头列宽度固定：目录展开与否、是文件还是目录，图标列都停在同一个 x 上。 */
.workspace-tree-twistie {
  @apply flex size-4 shrink-0 items-center justify-center;

  color: var(--muted-foreground);
}

.workspace-tree-icon {
  @apply size-4 shrink-0;

  color: var(--muted-foreground);
}

.workspace-tree-row.is-selected .workspace-tree-twistie,
.workspace-tree-row.is-selected .workspace-tree-icon {
  color: inherit;
}

.workspace-tree-label {
  @apply ml-1 min-w-0 truncate;
}

.workspace-tree-hint {
  @apply ml-1 shrink-0 text-xs;

  color: var(--muted-foreground);
}

.workspace-tree-empty {
  @apply px-3 py-4 text-xs;

  color: var(--muted-foreground);
}
</style>
