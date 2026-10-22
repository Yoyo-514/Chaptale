<script setup lang="ts">
import { PopoverArrow, PopoverClose, PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useCreationStore } from '@/features/creation';

import { type SessionEntry, useAgentStore } from '../store';

const emit = defineEmits<{ select: [] }>();
const agent = useAgentStore();
const creation = useCreationStore();
const query = ref('');
/** all、independent 或 work:<作品 ID>；默认看当前作品。 */
const filter = ref(creation.workId ? `work:${creation.workId}` : 'all');
const confirming = ref<string>();
const assigning = ref(false);
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
async function view(entry: SessionEntry) {
  if (await agent.view(entry)) emit('select');
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
    <AppScrollArea class="agent-history-scroll" viewport-class="agent-history" aria-label="会话历史">
      <div v-for="entry in visible" :key="entry.key" class="session-history-row">
        <button
          type="button"
          class="agent-session-link session-history-link"
          :aria-current="entry.live && entry.live.id === agent.activeId ? 'page' : undefined"
          @click="view(entry)"
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
          v-if="creation.work && entry.workId === null && sessionId(entry)"
          :open="confirming === entry.key"
          @update:open="open => (confirming = open ? entry.key : assigning ? confirming : undefined)"
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
      </div>
      <p v-if="!visible.length" class="agent-empty-small">
        {{ query.trim() ? '没有匹配的会话。' : '这里还没有会话。' }}
      </p>
    </AppScrollArea>
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
