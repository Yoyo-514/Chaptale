<script setup lang="ts">
import { PopoverArrow, PopoverClose, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { requestCreation, useCreationStore } from '@/features/creation';

import { type SessionEntry, useAgentStore } from '../store';

const emit = defineEmits<{ select: [] }>();
const agent = useAgentStore();
const creation = useCreationStore();
const query = ref('');
/** all、independent 或 work:<作品 ID>；默认看当前作品。 */
const filter = ref(creation.workId ? `work:${creation.workId}` : 'all');
const confirming = ref<string>();
const assigning = ref(false);
/** 多选按 VS Code 习惯：Ctrl/⌘ 单击切换，Shift 单击按可见顺序连选，普通单击打开会话。 */
const selected = ref(new Set<string>());
let anchor: string | undefined;
const menuTarget = ref<SessionEntry>();
/** 确认框关闭不清空待删列表：确认按钮会先关闭对话框，再触发删除。 */
const removing = ref<SessionEntry[]>([]);
const removingPending = ref(0);
const confirmOpen = ref(false);
const workTitles = computed(() => new Map(creation.works.map(work => [work.id, work.title])));
const filters = computed(() => [
  { value: 'all', label: '全部会话', hint: '' },
  { value: 'independent', label: '独立会话', hint: '' },
  ...creation.works.map(work => ({
    value: `work:${work.id}`,
    label: work.title,
    hint: work.id === creation.workId ? '当前作品' : ''
  }))
]);
const visible = computed(() => {
  const text = query.value.trim().toLowerCase();
  return agent.entries.filter(entry => {
    if (filter.value === 'independent' && entry.workId !== null) return false;
    if (filter.value.startsWith('work:') && entry.workId !== filter.value.slice(5)) return false;
    return !text || entry.title.toLowerCase().includes(text);
  });
});
function owner(entry: SessionEntry) {
  return entry.workId === null ? '独立会话' : (workTitles.value.get(entry.workId) ?? '已删除的作品');
}
function time(value: string) {
  if (!value) return '新会话';
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
function sessionId(entry: SessionEntry) {
  return entry.item?.id ?? entry.live?.sessionId ?? null;
}
onMounted(() => {
  void agent.loadHistory();
});
function running(entry: SessionEntry) {
  return Boolean(entry.live?.running || entry.live?.compacting);
}
function toggle(entry: SessionEntry) {
  const next = new Set(selected.value);
  if (!next.delete(entry.key)) next.add(entry.key);
  selected.value = next;
  anchor = entry.key;
}
function click(entry: SessionEntry, event: MouseEvent) {
  if (event.ctrlKey || event.metaKey) {
    toggle(entry);
    return;
  }
  if (event.shiftKey && anchor) {
    const keys = visible.value.map(item => item.key);
    const [from, to] = [keys.indexOf(anchor), keys.indexOf(entry.key)].toSorted((a, b) => a - b);
    selected.value = new Set(keys.slice(from, to + 1));
    return;
  }
  selected.value = new Set();
  anchor = entry.key;
  void view(entry);
}
async function view(entry: SessionEntry) {
  if (await agent.view(entry)) emit('select');
}
/** 操作对象：目标在多选内时作用于全部已选，否则只作用于目标。 */
function targetsOf(entry: SessionEntry) {
  return selected.value.has(entry.key) ? visible.value.filter(item => selected.value.has(item.key)) : [entry];
}
async function askRemove(entries: SessionEntry[]) {
  if (!entries.length) return;
  if (entries.some(running)) {
    agent.error = '有会话正在运行，停止后才能删除';
    return;
  }
  agent.error = '';
  const ids = entries.map(sessionId).filter(id => id !== null);
  const lists = await Promise.all(ids.map(id => requestCreation('listReviewItems', { sessionId: id })));
  removingPending.value = lists.flat().reduce((sum, item) => sum + item.count, 0);
  removing.value = entries;
  confirmOpen.value = true;
}
async function remove() {
  const ids = removing.value.map(sessionId).filter(id => id !== null);
  if (await agent.deleteSessions(ids)) selected.value = new Set();
}
/** 只有右键点中会话行时才有菜单；空白处不弹出。 */
const menuItems = computed<AppContextMenuItem[]>(() => {
  const target = menuTarget.value;
  if (!target || !sessionId(target)) return [];
  const count = selected.value.has(target.key) ? selected.value.size : 1;
  return [{ id: 'delete', label: count > 1 ? `删除 ${count} 个会话` : '删除' }];
});
function prepareMenu(event: MouseEvent) {
  const key = (event.target as HTMLElement).closest<HTMLElement>('[data-session-key]')?.dataset.sessionKey;
  menuTarget.value = visible.value.find(item => item.key === key);
}
function selectMenu(id: string) {
  if (id === 'delete' && menuTarget.value) void askRemove(targetsOf(menuTarget.value));
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Delete') return;
  const key = (event.target as HTMLElement).closest<HTMLElement>('[data-session-key]')?.dataset.sessionKey;
  const entry = visible.value.find(item => item.key === key);
  if (entry) void askRemove(targetsOf(entry));
  else if (selected.value.size) void askRemove(visible.value.filter(item => selected.value.has(item.key)));
}
async function assign(entry: SessionEntry) {
  assigning.value = true;
  if (await agent.assign(sessionId(entry)!)) confirming.value = undefined;
  assigning.value = false;
}
</script>

<template>
  <div class="agent-subpage">
    <div class="agent-subpage-toolbar session-history-toolbar">
      <AppInput v-model="query" type="search" placeholder="搜索会话标题" aria-label="搜索会话" />
      <AppSelect v-model="filter" aria-label="会话范围" content-size="md">
        <AppSelectItem v-for="item in filters" :key="item.value" :value="item.value">
          {{ item.label }}
          <template v-if="item.hint" #hint>{{ item.hint }}</template>
        </AppSelectItem>
      </AppSelect>
    </div>
    <div v-if="selected.size" class="session-selection-bar" role="toolbar" aria-label="已选会话">
      <span class="flex-1">已选 {{ selected.size }} 个</span>
      <AppButton size="xs" variant="ghost" @click="selected = new Set()">取消选择</AppButton>
      <AppButton size="xs" variant="ghost" @click="askRemove(visible.filter(item => selected.has(item.key)))"
        >删除</AppButton
      >
    </div>
    <AppContextMenu :items="menuItems" @prepare="prepareMenu" @select="selectMenu">
      <AppScrollArea
        class="agent-history-scroll"
        viewport-class="agent-history"
        aria-label="会话历史"
        @keydown="onKeydown"
      >
        <div
          v-for="entry in visible"
          :key="entry.key"
          class="session-history-row"
          :class="{ 'is-selected': selected.has(entry.key), 'is-selecting': selected.size > 0 }"
          :data-session-key="entry.key"
        >
          <AppCheckbox
            v-if="sessionId(entry)"
            class="session-check"
            size="sm"
            :model-value="selected.has(entry.key)"
            :aria-label="`选择${entry.title}`"
            @update:model-value="toggle(entry)"
          />
          <button
            type="button"
            class="agent-session-link session-history-link"
            :aria-current="entry.live && entry.live.id === agent.activeId ? 'page' : undefined"
            :aria-selected="selected.size ? selected.has(entry.key) : undefined"
            @click="click(entry, $event)"
          >
            <span class="session-history-title">{{ entry.title }}</span>
            <span class="session-history-meta">
              <span class="truncate">{{ owner(entry) }}</span>
              <span v-if="entry.live?.running">· 生成中</span>
              <span v-else-if="entry.live?.readonly">· 只读</span>
              <time v-if="entry.modified" :datetime="entry.modified">{{ time(entry.modified) }}</time>
              <span v-else>{{ time(entry.modified) }}</span>
            </span>
          </button>
          <PopoverRoot
            v-if="creation.work && entry.workId === null && entry.item"
            :open="confirming === entry.key"
            @update:open="
              open => {
                if (!open && !assigning) agent.error = '';
                confirming = open ? entry.key : assigning ? confirming : undefined;
              }
            "
          >
            <PopoverTrigger as-child>
              <AppButton variant="ghost" size="xs" :aria-label="`将${entry.title}归入当前作品`">归入</AppButton>
            </PopoverTrigger>
            <PopoverPortal>
              <PopoverContent class="session-assign-popover" side="bottom" align="end" :side-offset="4">
                <p>归入《{{ creation.work.title }}》后不能改回。</p>
                <p v-if="agent.error" role="alert" class="agent-error">{{ agent.error }}</p>
                <div class="session-assign-actions">
                  <PopoverClose as-child><AppButton size="xs" :disabled="assigning">取消</AppButton></PopoverClose>
                  <AppButton size="xs" variant="primary" :disabled="assigning" @click="assign(entry)">{{
                    assigning ? '归入中…' : '归入'
                  }}</AppButton>
                </div>
                <PopoverArrow class="session-assign-arrow" />
              </PopoverContent>
            </PopoverPortal>
          </PopoverRoot>
          <AppTooltip v-if="sessionId(entry)" :text="running(entry) ? '运行中，停止后才能删除' : '删除会话'">
            <AppButton
              variant="ghost"
              size="xs"
              class="session-delete"
              :disabled="running(entry)"
              :aria-label="`删除${entry.title}`"
              @click="askRemove(targetsOf(entry))"
              ><span class="i-mingcute-delete-2-line size-3.5" aria-hidden="true"
            /></AppButton>
          </AppTooltip>
        </div>
        <p v-if="!visible.length" class="agent-empty-small">
          {{ query.trim() ? '没有匹配的会话。' : '这里还没有会话。' }}
        </p>
      </AppScrollArea>
    </AppContextMenu>
    <AppAlertDialog
      v-model:open="confirmOpen"
      :title="removing.length > 1 ? `删除 ${removing.length} 个会话？` : `删除“${removing[0]?.title}”？`"
      confirm-label="删除"
      @confirm="remove"
    >
      <template #description>
        会话记录会移入系统回收站。<template v-if="removingPending"
          >这些会话还有 {{ removingPending }} 处待审修改，将一并拒绝。</template
        >
      </template>
    </AppAlertDialog>
  </div>
</template>

<style scoped>
.session-history-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 132px);
  gap: 6px;
}
.session-history-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--radius-control);
}
.session-history-row.is-selected {
  background: var(--accent);
}
.session-check {
  margin-left: 6px;
}
.session-delete,
.session-check {
  opacity: 0;
}
.session-history-row:hover .session-delete,
.session-history-row:focus-within .session-delete,
.session-history-row:hover .session-check,
.session-history-row:focus-within .session-check,
.session-history-row.is-selecting .session-check {
  opacity: 1;
}
.session-selection-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.session-history-link {
  height: auto;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 6px 8px;
}
.session-history-title {
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-history-meta {
  display: flex;
  min-width: 0;
  gap: 4px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 16px;
}
.session-history-meta > time,
.session-history-meta > span:last-child {
  margin-left: auto;
  flex-shrink: 0;
}
</style>

<style>
.session-assign-popover {
  z-index: var(--z-popover);
  display: flex;
  width: 220px;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--popover);
  box-shadow: var(--shadow-float);
  color: var(--popover-foreground);
  font-size: var(--ui-font-size);
}
.session-assign-popover p {
  margin: 0;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.session-assign-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.session-assign-arrow {
  fill: var(--popover);
}
</style>

<style lang="scss">
.agent-session-link:hover {
  background: var(--surface-hover);
}
.agent-session-link[aria-current='page'] {
  background: var(--secondary);
  color: var(--primary-solid);
}
.agent-subpage-toolbar {
  flex-shrink: 0;
  padding: 12px 16px 4px;
}
.agent-history-scroll {
  min-height: 0;
  flex: 1;
}
.agent-history {
  box-sizing: border-box;
  padding: 4px 8px 16px;
}
.agent-history h4 {
  margin: 16px 8px 4px;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 600;
}
.agent-session-link {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-control-sm);
  background: transparent;
  color: var(--foreground);
  font-size: var(--ui-font-size);
  text-align: left;
  cursor: pointer;
}
.agent-session-link > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-session-link > time,
.agent-session-link > span + span {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
</style>
