<script setup lang="ts">
import { ref } from 'vue';

import type { SubagentState } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { getDesktopApi, hasDesktopApi } from '@/stores/utils/desktop-api';

import { isTerminalState, type SubagentTaskEntry } from '../composables/useSubagentTasks';

const props = defineProps<{
  tasks: SubagentTaskEntry[];
}>();

const emit = defineEmits<{
  cancel: [requestId: string];
  dismiss: [requestId: string];
}>();

const stateMeta: Record<SubagentState, { label: string; icon: string; className: string }> = {
  queued: { label: '排队中', icon: 'i-mingcute-time-line', className: 'subagent-state-pending' },
  running: { label: '执行中', icon: 'i-mingcute-loading-3-line animate-spin', className: 'subagent-state-running' },
  success: { label: '完成', icon: 'i-mingcute-check-circle-fill', className: 'subagent-state-success' },
  failed: { label: '失败', icon: 'i-mingcute-close-circle-fill', className: 'subagent-state-failed' },
  cancelled: { label: '已取消', icon: 'i-mingcute-forbid-circle-line', className: 'subagent-state-muted' },
  timeout: { label: '超时', icon: 'i-mingcute-alarm-2-line', className: 'subagent-state-failed' }
};

function usageLabel(task: SubagentTaskEntry): string | undefined {
  return task.usage ? `${task.usage.inputTokens + task.usage.outputTokens} tokens` : undefined;
}

// 展开查看的路：一次只展开一路，再次点击收起；正文按需拉取不预加载。
const expandedRequestId = ref<string | null>(null);
const expandedText = ref('');

async function toggleOutput(task: SubagentTaskEntry) {
  if (expandedRequestId.value === task.requestId) {
    expandedRequestId.value = null;
    return;
  }

  if (!task.outputRef || !hasDesktopApi()) {
    return;
  }

  const output = await getDesktopApi().tasks.readRunOutput(task.outputRef);
  expandedText.value = output?.rawText ?? '（结果文件不可读）';
  expandedRequestId.value = task.requestId;
}
</script>

<template>
  <section v-if="props.tasks.length > 0" class="subagent-card" aria-label="子任务进度">
    <AppScrollArea class="subagent-scroll">
      <ul class="subagent-list">
        <li v-for="task in props.tasks" :key="task.requestId" class="subagent-item">
          <span
            :class="['size-4 shrink-0', stateMeta[task.state].icon, stateMeta[task.state].className]"
            aria-hidden="true"
          />
          <span class="subagent-item-persona">{{ task.personaId }}</span>
          <span :class="['subagent-item-state', stateMeta[task.state].className]">{{
            stateMeta[task.state].label
          }}</span>
          <span v-if="task.error" class="subagent-item-error" :title="task.error">{{ task.error }}</span>
          <span v-if="usageLabel(task)" class="subagent-item-usage">{{ usageLabel(task) }}</span>
          <AppButton
            v-if="isTerminalState(task.state) && task.outputRef"
            variant="ghost"
            size="xs"
            type="button"
            @click="toggleOutput(task)"
          >
            {{ expandedRequestId === task.requestId ? '收起' : '查看' }}
          </AppButton>
          <AppButton
            v-if="!isTerminalState(task.state)"
            variant="ghost"
            size="xs"
            type="button"
            @click="emit('cancel', task.requestId)"
          >
            取消
          </AppButton>
          <AppButton v-else variant="ghost" size="xs" type="button" @click="emit('dismiss', task.requestId)">
            清除
          </AppButton>
        </li>
      </ul>
    </AppScrollArea>
    <AppScrollArea v-if="expandedRequestId" class="subagent-output-scroll">
      <pre class="subagent-output">{{ expandedText }}</pre>
    </AppScrollArea>
  </section>
</template>

<style scoped lang="scss">
.subagent-card {
  @apply text-sm;

  border-bottom: 1px solid var(--border-subtle);
}

.subagent-scroll {
  // 至多 4 行可见（每行 1.75rem），超出滚动；多路 gather 时保持紧凑。
  max-height: calc(4 * 1.75rem);
}

.subagent-list {
  @apply m-0 list-none px-3 py-1;
}

.subagent-output-scroll {
  // 结果正文区限高，避免长输出挤压输入框。
  max-height: 12rem;

  border-top: 1px solid var(--border-subtle);
}

.subagent-output {
  @apply m-0 whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs;

  color: var(--muted-foreground);
}

.subagent-item {
  @apply flex h-7 items-center gap-2;
}

.subagent-item-persona {
  @apply min-w-0 truncate font-medium;

  color: var(--foreground);
}

.subagent-item-state {
  @apply shrink-0 text-xs;
}

.subagent-item-error {
  @apply min-w-0 flex-1 truncate text-xs;

  color: var(--muted-foreground);
}

.subagent-item-usage {
  @apply ml-auto shrink-0 text-xs;

  color: var(--muted-foreground);
}

.subagent-state-pending,
.subagent-state-muted {
  color: var(--muted-foreground);
}

.subagent-state-running {
  color: var(--primary);
}

.subagent-state-success {
  color: var(--primary);
}

.subagent-state-failed {
  color: var(--destructive, #b91c1c);
}
</style>
