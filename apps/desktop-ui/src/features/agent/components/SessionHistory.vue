<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { HistoryItem } from '@chaptale/agent-host/protocol';

import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTabs } from '@/components/AppTabs';
import { useWorkspaceStore } from '@/features/workspace';

import { useAgentStore } from '../store';

const emit = defineEmits<{ select: [] }>();
const agent = useAgentStore();
const workspace = useWorkspaceStore();
const scope = ref(workspace.rootPath ? 'workspace' : 'independent');
const scopes = computed(() => [
  ...(workspace.rootPath ? [{ value: 'workspace', label: workspace.displayName ?? '本作品' }] : []),
  { value: 'independent', label: '独立会话' }
]);
const cwd = computed(() => (scope.value === 'workspace' ? workspace.rootPath! : agent.state!.cwd));
const opened = computed(() => agent.state!.sessions.filter(item => item.cwd === cwd.value));
const saved = computed(() => agent.history.filter(item => !opened.value.some(session => session.id === item.id)));

/** 按「今天 / 昨天 / 近 7 天 / 更早」分组，组内保持宿主给的顺序。 */
const groups = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const buckets: { label: string; items: HistoryItem[] }[] = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '近 7 天', items: [] },
    { label: '更早', items: [] }
  ];
  for (const item of saved.value) {
    const age = today.getTime() - new Date(item.modified).getTime();
    buckets[age <= 0 ? 0 : age <= day ? 1 : age <= 7 * day ? 2 : 3]!.items.push(item);
  }
  return buckets.filter(bucket => bucket.items.length);
});
function time(value: string) {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
watch(
  cwd,
  value => {
    void agent.loadHistory(value === agent.state!.cwd ? undefined : value);
  },
  { immediate: true }
);
function select(id: string) {
  agent.select(id);
  emit('select');
}
async function open(item: HistoryItem) {
  await agent.open(item);
  if (agent.activeId === item.id) emit('select');
}
</script>

<template>
  <div class="agent-subpage">
    <div class="agent-subpage-toolbar">
      <AppTabs v-model="scope" :items="scopes" label="历史范围" />
    </div>
    <AppScrollArea class="agent-history-scroll" viewport-class="agent-history" aria-label="会话历史">
      <template v-if="opened.length">
        <h4>已打开</h4>
        <button
          v-for="session in opened"
          :key="session.id"
          type="button"
          class="agent-session-link"
          :aria-label="`查看${agent.title(session)}`"
          :aria-current="session.id === agent.activeId ? 'page' : undefined"
          @click="select(session.id)"
        >
          <span>{{ agent.title(session) }}</span>
          <span v-if="session.running">生成中</span>
          <span v-else-if="session.readonly">只读</span>
        </button>
      </template>
      <template v-for="group in groups" :key="group.label">
        <h4>{{ group.label }}</h4>
        <button v-for="item in group.items" :key="item.id" type="button" class="agent-session-link" @click="open(item)">
          <span>{{ item.title }}</span
          ><time :datetime="item.modified">{{ time(item.modified) }}</time>
        </button>
      </template>
      <p v-if="!opened.length && !saved.length" class="agent-empty-small">这里还没有会话。</p>
    </AppScrollArea>
  </div>
</template>
