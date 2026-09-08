<script setup lang="ts">
import { Background } from '@vue-flow/background';
import {
  Handle,
  MarkerType,
  Position,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeDragEvent
} from '@vue-flow/core';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';

import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

import type { AssetRecord } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useTemplateStore } from '@/features/templates';
import { useWorkspaceActions, useWorkspaceStore } from '@/features/workspace';

import {
  characterGraph,
  characterLayoutKey,
  readCanvasLayout,
  type CanvasLayout,
  type CharacterConnection
} from '../story-model';
import { useStoryStore } from '../story-store';
import AssetContextMenu from './AssetContextMenu.vue';

const workspace = useWorkspaceStore();
const library = useLibraryStore();
const editor = useEditorStore();
const templates = useTemplateStore();
const actions = useWorkspaceActions();
const story = useStoryStore();
const flow = useVueFlow({ id: 'story-relationships' });
const query = ref('');
const archived = ref(false);
const selected = ref('');
const layoutError = ref('');
const storageKey = `chaptale:character-layout:${encodeURIComponent(workspace.rootPath ?? '')}`;
let layout: CanvasLayout = { version: 1, positions: {} };
try {
  layout = readCanvasLayout(localStorage.getItem(storageKey));
} catch {
  layoutError.value = '本机画布布局暂时不可读取';
}
const initialViewport = layout.viewport;
const graph = computed(() => characterGraph(library.assets, query.value, archived.value));
const nodes = shallowRef<Node<{ asset: AssetRecord; count: number }>[]>([]);
function connectionHandles(source: string, target: string) {
  const from = nodes.value.find(node => node.id === source)?.position;
  const to = nodes.value.find(node => node.id === target)?.position;
  if (!from || !to || to.x > from.x) return { sourceHandle: 'source-right', targetHandle: 'target-left' };
  if (to.x < from.x) return { sourceHandle: 'source-left', targetHandle: 'target-right' };
  const side = to.y >= from.y ? 'right' : 'left';
  return { sourceHandle: `source-${side}`, targetHandle: `target-${side}` };
}
const edges = computed<Edge<CharacterConnection>[]>(() =>
  graph.value.connections.flatMap(connection =>
    connection.target
      ? [
          {
            id: `${connection.source.sourcePath}:${connection.index}`,
            source: connection.source.sourcePath,
            target: connection.target.sourcePath,
            ...connectionHandles(connection.source.sourcePath, connection.target.sourcePath),
            label: connection.type,
            data: connection,
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)' },
            labelStyle: { fill: 'var(--foreground)', fontSize: 13 },
            labelBgStyle: { fill: 'var(--surface-elevated)', fillOpacity: 1 },
            labelBgBorderRadius: 3,
            labelBgPadding: [5, 4],
            interactionWidth: 24,
            ariaLabel: `${connection.source.title} 到 ${connection.target.title}：${connection.type}`,
            deletable: false
          }
        ]
      : []
  )
);
const unresolved = computed(() => graph.value.connections.filter(connection => !connection.target));
const selectedAsset = computed(() => graph.value.characters.find(asset => asset.sourcePath === selected.value));
const selectionConnections = computed(() =>
  graph.value.connections.filter(
    connection =>
      !selected.value ||
      connection.source.sourcePath === selected.value ||
      connection.target?.sourcePath === selected.value
  )
);
function position(index: number) {
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(graph.value.characters.length))));
  return { x: (index % columns) * 270 + 40, y: Math.floor(index / columns) * 170 + 40 };
}
watch(
  () => graph.value.characters,
  characters => {
    nodes.value = characters.map((asset, index) => ({
      id: asset.sourcePath,
      type: 'character',
      position: layout.positions[characterLayoutKey(asset, story.characters)] ?? position(index),
      data: {
        asset,
        count: graph.value.connections.filter(
          connection =>
            connection.source.sourcePath === asset.sourcePath || connection.target?.sourcePath === asset.sourcePath
        ).length
      },
      ariaLabel: `角色 ${asset.title}`,
      deletable: false
    }));
    if (selected.value && !characters.some(asset => asset.sourcePath === selected.value)) selected.value = '';
  },
  { immediate: true }
);
function persistViewport() {
  layout.viewport = flow.getViewport();
  try {
    localStorage.setItem(storageKey, JSON.stringify(layout));
    layoutError.value = '';
  } catch {
    layoutError.value = '本机画布布局保存失败，角色文件未受影响';
  }
}
function rememberPositions(event: NodeDragEvent) {
  for (const node of event.nodes.length ? event.nodes : [event.node]) {
    const asset = graph.value.characters.find(value => value.sourcePath === node.id);
    if (asset)
      layout.positions[characterLayoutKey(asset, story.characters)] = { x: node.position.x, y: node.position.y };
  }
  persistViewport();
}
async function arrange() {
  nodes.value = nodes.value.map((node, index) => {
    const next = position(index);
    layout.positions[characterLayoutKey(node.data!.asset, story.characters)] = next;
    return Object.assign({}, node, { position: next });
  });
  await nextTick();
  await flow.fitView({ padding: 0.2, maxZoom: 1.1 });
  persistViewport();
}
async function focusSelected(value: string) {
  selected.value = value === '__all' ? '' : value;
  await flow.fitView({
    nodes: selected.value ? [selected.value] : undefined,
    maxZoom: 1.2,
    padding: 0.3,
    duration: 180
  });
}
function connect(connection: Connection) {
  if (connection.source !== connection.target) void story.newRelation(connection.source, connection.target);
}
function editEdge(id: string) {
  const connection = graph.value.connections.find(item => `${item.source.sourcePath}:${item.index}` === id);
  if (connection) void story.editRelation(connection);
}
</script>
<template>
  <section class="character-graph" aria-label="作品角色关系">
    <header class="graph-heading">
      <h2>
        角色关系 <span>{{ graph.characters.length }} 位角色 · {{ edges.length }} 条关系</span>
      </h2>
      <AppButton @click="templates.openCreate('character-main')"
        ><span class="i-mingcute-user-add-line" aria-hidden="true" />新建角色</AppButton
      >
      <AppButton
        variant="primary"
        :disabled="story.characters.length < 2"
        @click="story.newRelation(selected || undefined)"
        ><span class="i-mingcute-link-line" aria-hidden="true" />新建关系</AppButton
      >
    </header>
    <div class="graph-filters">
      <AppInput v-model="query" aria-label="筛选角色关系" placeholder="筛选角色关系"
        ><template #prefix><span class="i-mingcute-search-line" aria-hidden="true" /></template
      ></AppInput>
      <AppSelect :model-value="selected || '__all'" aria-label="定位角色" @update:model-value="focusSelected($event)"
        ><AppSelectItem value="__all">全部角色</AppSelectItem
        ><AppSelectItem v-for="asset in graph.characters" :key="asset.sourcePath" :value="asset.sourcePath">{{
          asset.title
        }}</AppSelectItem></AppSelect
      >
      <label><AppCheckbox v-model="archived" />包含归档</label>
    </div>
    <p v-if="layoutError || library.error" class="graph-error" role="alert">{{ layoutError || library.error }}</p>
    <div class="graph-canvas">
      <VueFlow
        v-if="nodes.length"
        id="story-relationships"
        v-model:nodes="nodes"
        :edges="edges"
        :default-viewport="initialViewport"
        :fit-view-on-init="!initialViewport"
        :min-zoom="0.15"
        :max-zoom="3"
        :delete-key-code="null"
        :nodes-focusable="true"
        :edges-focusable="true"
        @connect="connect"
        @node-drag-stop="rememberPositions"
        @move-end="persistViewport"
        @node-click="selected = $event.node.id"
        @node-double-click="editor.openDocument($event.node.id)"
        @edge-click="editEdge($event.edge.id)"
      >
        <Background variant="lines" :gap="32" :line-width="0.5" color="var(--border-subtle)" />
        <template #node-character="{ data }">
          <AssetContextMenu :asset="data.asset">
            <div
              class="character-node"
              :class="{ 'is-chosen': selected === data.asset.sourcePath }"
              :data-character-path="data.asset.sourcePath"
            >
              <Handle id="target-left" type="target" :position="Position.Left" :style="{ top: '30%' }" />
              <Handle id="source-left" type="source" :position="Position.Left" :style="{ top: '70%' }" />
              <span class="i-mingcute-user-3-line character-node-icon" aria-hidden="true" />
              <strong>{{ data.asset.title }}</strong>
              <small>{{ data.count }} 条关系{{ data.asset.status === 'archived' ? ' · 已归档' : '' }}</small>
              <Handle id="source-right" type="source" :position="Position.Right" :style="{ top: '30%' }" />
              <Handle id="target-right" type="target" :position="Position.Right" :style="{ top: '70%' }" />
            </div>
          </AssetContextMenu>
        </template>
      </VueFlow>
      <p v-else class="graph-empty" role="status">{{ library.loading ? '正在读取角色' : '没有匹配的角色' }}</p>
      <div class="graph-tools" role="toolbar" aria-label="关系画布工具">
        <AppTooltip text="放大"
          ><AppButton icon variant="ghost" aria-label="放大关系图" :disabled="!nodes.length" @click="flow.zoomIn()"
            ><span class="i-mingcute-add-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppTooltip text="缩小"
          ><AppButton icon variant="ghost" aria-label="缩小关系图" :disabled="!nodes.length" @click="flow.zoomOut()"
            ><span class="i-mingcute-minimize-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppTooltip text="适应画布"
          ><AppButton
            icon
            variant="ghost"
            aria-label="适应关系画布"
            :disabled="!nodes.length"
            @click="flow.fitView({ padding: 0.2, maxZoom: 1.2 })"
            ><span class="i-mingcute-fullscreen-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppTooltip text="重新排列"
          ><AppButton icon variant="ghost" aria-label="重新排列角色" :disabled="!nodes.length" @click="arrange"
            ><span class="i-mingcute-grid-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
        <AppTooltip text="刷新"
          ><AppButton icon variant="ghost" aria-label="刷新关系图" :disabled="library.loading" @click="library.load"
            ><span class="i-mingcute-refresh-3-line" aria-hidden="true" /></AppButton
        ></AppTooltip>
      </div>
    </div>
    <div v-if="selectedAsset" class="graph-selection">
      <strong>{{ selectedAsset.title }}</strong>
      <AppButton size="sm" variant="ghost" @click="editor.openDocument(selectedAsset.sourcePath)"
        ><span class="i-mingcute-document-line" aria-hidden="true" />打开角色</AppButton
      >
      <AppButton size="sm" variant="ghost" @click="actions.askAgent(selectedAsset.sourcePath)"
        ><span class="i-mingcute-chat-3-line" aria-hidden="true" />与 Agent 讨论</AppButton
      >
    </div>
    <details class="graph-connections">
      <summary>
        关系清单 · {{ selectionConnections.length
        }}<span v-if="unresolved.length" class="graph-warning"> · {{ unresolved.length }} 条引用待确认</span>
      </summary>
      <ul>
        <li v-for="connection in selectionConnections" :key="`${connection.source.sourcePath}:${connection.index}`">
          <AppButton variant="ghost" @click="story.editRelation(connection)"
            >{{ connection.source.title }} → {{ connection.type }} → {{ connection.target?.title ?? connection.to
            }}<span v-if="!connection.target" class="graph-warning"
              >（{{
                connection.link.status === 'ambiguous'
                  ? '重名'
                  : connection.link.targetPath
                    ? '目标不在当前角色视图'
                    : '未找到目标'
              }}）</span
            ></AppButton
          >
        </li>
      </ul>
    </details>
  </section>
</template>
<style scoped lang="scss">
.character-graph {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
.graph-heading {
  @apply flex min-h-14 shrink-0 flex-wrap items-center gap-2 px-5 py-3;
}
.graph-heading h2 {
  @apply m-0 min-w-0 flex-1 text-base font-semibold;
}
.graph-heading h2 span {
  @apply ml-2 text-xs font-normal;
  color: var(--muted-foreground);
}
.graph-filters {
  @apply flex shrink-0 flex-wrap items-center gap-3 border-b px-5 pb-3;
  border-color: var(--border-subtle);
}
.graph-filters > :first-child {
  @apply min-w-36 flex-1;
}
.graph-filters :deep(.app-select-trigger) {
  max-width: 180px;
}
.graph-filters label {
  @apply flex items-center gap-2;
  color: var(--muted-foreground);
}
.graph-canvas {
  @apply relative min-h-48 min-w-0 flex-1 overflow-hidden;
  background: var(--background);
}
.graph-tools {
  @apply absolute bottom-3 left-3 flex gap-1 border p-1;
  background: var(--surface-elevated);
  border-color: var(--border-subtle);
  border-radius: 4px;
}
.character-node {
  @apply grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border px-3 py-3;
  width: 184px;
  height: 82px;
  border-radius: 6px;
  background: var(--surface-elevated);
  border-color: var(--border);
  color: var(--foreground);
  text-align: left;
}
.character-node.is-chosen {
  border-color: var(--primary-solid);
  box-shadow: 0 0 0 1px var(--primary-solid);
}
.character-node-icon {
  @apply size-6;
  grid-row: span 2;
  color: var(--primary-solid);
}
.character-node strong {
  @apply line-clamp-2 text-sm font-semibold;
  overflow-wrap: anywhere;
}
.character-node small {
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.character-node :deep(.vue-flow__handle) {
  width: 9px;
  height: 9px;
  border-color: var(--surface-elevated);
  background: var(--primary-solid);
}
.graph-canvas :deep(.vue-flow__edge-path) {
  stroke: var(--muted-foreground);
  stroke-width: 1.5;
}
.graph-canvas :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: var(--primary-solid);
  stroke-width: 2.5;
}
.graph-canvas :deep(.vue-flow__edge-text) {
  pointer-events: all;
  cursor: pointer;
}
.graph-canvas :deep(.vue-flow__edge-textbg) {
  pointer-events: none;
}
.graph-canvas :deep(.vue-flow__node:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: 4px;
}
.graph-selection {
  @apply flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2;
  border-color: var(--border-subtle);
}
.graph-selection strong {
  @apply mr-auto min-w-0;
  overflow-wrap: anywhere;
}
.graph-connections {
  @apply shrink-0 border-t;
  max-height: 35%;
  overflow: auto;
  border-color: var(--border-subtle);
}
.graph-connections summary {
  @apply cursor-pointer px-4 py-2;
}
.graph-connections ul {
  @apply m-0 list-none px-2 pb-2;
}
.graph-connections button {
  @apply h-auto min-w-0 justify-start py-2 text-left;
  white-space: normal;
  overflow-wrap: anywhere;
}
.graph-error,
.graph-empty {
  @apply m-0 p-5;
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
.graph-error {
  color: var(--destructive);
}
.graph-warning {
  color: var(--warning);
}
</style>
