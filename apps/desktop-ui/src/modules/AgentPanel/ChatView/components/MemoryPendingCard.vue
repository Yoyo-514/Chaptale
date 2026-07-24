<script setup lang="ts">
import { ref } from 'vue';

import type { MemoryPendingAction, MemoryPendingProposal, MemoryProposalType } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';

const props = defineProps<{
  proposals: MemoryPendingProposal[];
  notice: string;
}>();

const emit = defineEmits<{
  resolve: [id: string, action: MemoryPendingAction];
}>();

const typeMeta: Record<MemoryProposalType, { label: string; className: string }> = {
  create: { label: '新建', className: 'memory-type-create' },
  update: { label: '更新', className: 'memory-type-update' },
  archive: { label: '归档', className: 'memory-type-archive' }
};

// 展开查看的提议：一次只展开一条，再次点击收起；内容随列表加载已在内存，无需拉取。
const expandedId = ref<string | null>(null);

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

function expandedProposal(): MemoryPendingProposal | undefined {
  return props.proposals.find(proposal => proposal.id === expandedId.value);
}
</script>

<template>
  <section v-if="props.proposals.length > 0 || props.notice" class="memory-pending-card" aria-label="记忆修改提议">
    <p v-if="props.notice" class="memory-pending-notice">{{ props.notice }}</p>
    <AppScrollArea class="memory-pending-scroll">
      <ul class="memory-pending-list">
        <li v-for="proposal in props.proposals" :key="proposal.id" class="memory-pending-item">
          <span :class="['memory-pending-type', typeMeta[proposal.proposalType].className]">{{
            typeMeta[proposal.proposalType].label
          }}</span>
          <span class="memory-pending-title" :title="proposal.reason">{{ proposal.title }}</span>
          <span class="memory-pending-path">{{ proposal.targetPath }}</span>
          <AppButton variant="ghost" size="xs" type="button" @click="toggleExpand(proposal.id)">
            {{ expandedId === proposal.id ? '收起' : '查看' }}
          </AppButton>
          <AppButton variant="ghost" size="xs" type="button" @click="emit('resolve', proposal.id, 'accept')">
            接受
          </AppButton>
          <AppButton variant="ghost" size="xs" type="button" @click="emit('resolve', proposal.id, 'reject')">
            拒绝
          </AppButton>
        </li>
      </ul>
    </AppScrollArea>
    <AppScrollArea v-if="expandedProposal()" class="memory-pending-detail-scroll">
      <div class="memory-pending-detail">
        <p class="memory-pending-reason">理由：{{ expandedProposal()!.reason }}</p>
        <pre v-if="expandedProposal()!.content" class="memory-pending-content">{{ expandedProposal()!.content }}</pre>
        <p v-else class="memory-pending-reason">归档提议：接受后目标文件将标记 status: archived（不删除文件）。</p>
      </div>
    </AppScrollArea>
  </section>
</template>

<style scoped lang="scss">
.memory-pending-card {
  @apply text-sm;

  border-bottom: 1px solid var(--border-subtle);
}

.memory-pending-notice {
  @apply m-0 px-3 py-1.5 text-xs;

  color: var(--warning, #b45309);
  border-bottom: 1px solid var(--border-subtle);
}

.memory-pending-scroll {
  // 至多 4 行可见，超出滚动；批量提议（结算线）时保持紧凑。
  max-height: calc(4 * 1.75rem);
}

.memory-pending-list {
  @apply m-0 list-none px-3 py-1;
}

.memory-pending-item {
  @apply flex h-7 items-center gap-2;
}

.memory-pending-type {
  @apply shrink-0 rounded px-1.5 text-xs;

  border: 1px solid var(--border-subtle);
}

.memory-pending-type-create,
.memory-type-create {
  color: var(--success, #15803d);
}

.memory-type-update {
  color: var(--info, #1d4ed8);
}

.memory-type-archive {
  color: var(--muted-foreground);
}

.memory-pending-title {
  @apply truncate;
}

.memory-pending-path {
  @apply ml-auto truncate text-xs;

  max-width: 40%;

  color: var(--muted-foreground);
}

.memory-pending-detail-scroll {
  // 提议内容区限高，避免长文本挤压输入框。
  max-height: 12rem;

  border-top: 1px solid var(--border-subtle);
}

.memory-pending-detail {
  @apply px-3 py-2;
}

.memory-pending-reason {
  @apply m-0 text-xs;

  color: var(--muted-foreground);
}

.memory-pending-content {
  @apply m-0 mt-1 whitespace-pre-wrap break-words font-mono text-xs;

  color: var(--muted-foreground);
}
</style>
