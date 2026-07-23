<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { PermissionAskEvent, PermissionDecideArgs } from '@chaptale/ipc-contract';
import type { RiskLevel } from '@chaptale/shared';

const props = defineProps<{
  requests: PermissionAskEvent[];
  isSubmitting: boolean;
}>();

const emit = defineEmits<{
  decide: [args: PermissionDecideArgs];
}>();

// 一次只处理队首请求；其余排队等待，避免多张卡片相互抢占注意力。
const current = computed(() => props.requests[0]);
const queuedCount = computed(() => Math.max(0, props.requests.length - 1));

// 拒绝理由输入：默认收起，点击"拒绝"后展开供选填；换请求时重置。
const showDenyInput = ref(false);
const denyReason = ref('');

watch(
  () => current.value?.requestId,
  () => {
    showDenyInput.value = false;
    denyReason.value = '';
  }
);

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  readonly: { label: '只读', className: 'permission-risk-readonly' },
  mutating: { label: '写入', className: 'permission-risk-mutating' },
  destructive: { label: '危险', className: 'permission-risk-destructive' }
};

/** allow-always 默认按 subject 精确匹配落规则；无 subject 时放行该工具全部调用。 */
function alwaysPattern(request: PermissionAskEvent): string {
  return request.subject ? `${request.toolName}(${request.subject})` : request.toolName;
}

function allowOnce() {
  if (current.value) {
    emit('decide', { requestId: current.value.requestId, decision: { outcome: 'allow-once' } });
  }
}

function allowAlways() {
  if (current.value) {
    emit('decide', {
      requestId: current.value.requestId,
      decision: { outcome: 'allow-always', scope: 'workspace', pattern: alwaysPattern(current.value) }
    });
  }
}

function deny() {
  if (!showDenyInput.value) {
    showDenyInput.value = true;
    return;
  }

  if (current.value) {
    const reason = denyReason.value.trim();
    emit('decide', {
      requestId: current.value.requestId,
      decision: reason ? { outcome: 'deny', reason } : { outcome: 'deny' }
    });
  }
}
</script>

<template>
  <section v-if="current" class="permission-card" aria-label="工具授权请求">
    <div class="permission-card-header">
      <span class="i-mingcute-shield-shape-line size-4 shrink-0" aria-hidden="true" />
      <span class="permission-card-title">
        请求执行 <code class="permission-card-tool">{{ current.toolName }}</code>
      </span>
      <span :class="['permission-risk', riskMeta[current.riskLevel].className]">
        {{ riskMeta[current.riskLevel].label }}
      </span>
      <span v-if="queuedCount > 0" class="permission-card-queued">还有 {{ queuedCount }} 项待处理</span>
    </div>

    <p v-if="current.subject" class="permission-card-subject" :title="current.subject">{{ current.subject }}</p>

    <div v-if="showDenyInput" class="permission-card-reason">
      <input
        v-model="denyReason"
        type="text"
        class="permission-card-reason-input"
        placeholder="可选：告诉模型拒绝的原因，便于它调整方案"
        maxlength="2000"
        @keydown.enter.prevent="deny"
      />
    </div>

    <div class="permission-card-actions">
      <button type="button" class="permission-btn permission-btn-primary" :disabled="isSubmitting" @click="allowOnce">
        仅此次允许
      </button>
      <button type="button" class="permission-btn" :disabled="isSubmitting" @click="allowAlways">总是允许</button>
      <button type="button" class="permission-btn permission-btn-danger" :disabled="isSubmitting" @click="deny">
        {{ showDenyInput ? '确认拒绝' : '拒绝' }}
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.permission-card {
  @apply flex flex-col gap-1.5 px-3 py-2 text-sm;

  border-bottom: 1px solid var(--border-subtle);
}

.permission-card-header {
  @apply flex items-center gap-2;

  color: var(--foreground);
}

.permission-card-title {
  @apply min-w-0 truncate font-medium;
}

.permission-card-tool {
  @apply rounded px-1 text-xs;

  background: var(--surface-muted);
}

.permission-risk {
  @apply shrink-0 rounded px-1.5 text-xs;
}

.permission-risk-readonly {
  color: var(--muted-foreground);
  background: var(--surface-muted);
}

.permission-risk-mutating {
  color: var(--warning, #b45309);
  background: var(--surface-muted);
}

.permission-risk-destructive {
  color: var(--destructive, #b91c1c);
  background: var(--surface-muted);
}

.permission-card-queued {
  @apply ml-auto shrink-0 text-xs;

  color: var(--muted-foreground);
}

.permission-card-subject {
  @apply m-0 truncate font-mono text-xs;

  color: var(--muted-foreground);
}

.permission-card-reason-input {
  @apply w-full rounded border px-2 py-1 text-xs outline-none;

  border-color: var(--border-subtle);
  background: transparent;
  color: var(--foreground);
}

.permission-card-actions {
  @apply flex items-center gap-2;
}

.permission-btn {
  @apply rounded border px-2.5 py-1 text-xs;

  border-color: var(--border-subtle);
  background: transparent;
  color: var(--foreground);

  &:hover:not(:disabled) {
    background: var(--surface-muted);
  }

  &:disabled {
    @apply cursor-not-allowed opacity-60;
  }
}

.permission-btn-primary {
  @apply font-medium;

  color: var(--primary);
}

.permission-btn-danger {
  color: var(--destructive, #b91c1c);
}
</style>
