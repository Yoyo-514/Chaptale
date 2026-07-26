<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { PermissionAskEvent, PermissionDecideArgs } from '@chaptale/ipc-contract';
import type { RiskLevel } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppTextarea } from '@/components/AppTextarea';

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

function allowOnce() {
  if (current.value) {
    emit('decide', { requestId: current.value.requestId, decision: { outcome: 'allow-once' } });
  }
}

function allowAlways() {
  if (current.value) {
    emit('decide', {
      requestId: current.value.requestId,
      decision: { outcome: 'allow-always', scope: 'workspace', pattern: current.value.toolName }
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
      <AppTextarea
        v-model="denyReason"
        :rows="2"
        resize="none"
        size="sm"
        variant="muted"
        placeholder="可选：告诉模型拒绝的原因，便于它调整方案"
        maxlength="2000"
        @keydown.ctrl.enter.prevent="deny"
        @keydown.meta.enter.prevent="deny"
      />
    </div>

    <div class="permission-card-actions">
      <AppButton variant="primary" size="xs" type="button" :disabled="isSubmitting" @click="allowOnce">
        仅此次允许
      </AppButton>
      <AppButton variant="secondary" size="xs" type="button" :disabled="isSubmitting" @click="allowAlways">
        本工作区始终允许
      </AppButton>
      <AppButton variant="danger" size="xs" type="button" :disabled="isSubmitting" @click="deny">
        {{ showDenyInput ? '确认拒绝' : '拒绝' }}
      </AppButton>
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

.permission-card-actions {
  @apply flex items-center gap-2;
}
</style>
