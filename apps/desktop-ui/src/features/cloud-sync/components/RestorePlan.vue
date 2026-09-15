<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import { computed } from 'vue';

import type { CloudRestoreMode } from '@chaptale/ipc-contract';

import { useCloudSyncStore } from '../store';
import type { RestoreWizardState } from '../store/types';

const props = defineProps<{ wizard: RestoreWizardState }>();
const cloud = useCloudSyncStore();
const stats = computed(() => [
  { key: 'add', value: props.wizard.plan.entries.filter(entry => entry.verdict === 'add').length, label: '新增' },
  {
    key: 'identical',
    value: props.wizard.plan.entries.filter(entry => entry.verdict === 'identical').length,
    label: '一致'
  },
  {
    key: 'conflict',
    value: props.wizard.plan.entries.filter(entry => entry.verdict === 'conflict').length,
    label: '冲突'
  },
  { key: 'local', value: props.wizard.plan.localOnly, label: '本地独有' }
]);
const modes: { value: CloudRestoreMode; icon: string; title: string; detail: string }[] = [
  {
    value: 'new',
    icon: 'i-mingcute-new-folder-line',
    title: '新增',
    detail: '解包到作品旁边的新目录，当前作品保持不动'
  },
  {
    value: 'overwrite',
    icon: 'i-mingcute-transfer-line',
    title: '覆盖',
    detail: '先留快照，再原地还原；本地独有文件保留'
  },
  {
    value: 'merge',
    icon: 'i-mingcute-list-check-line',
    title: '合并',
    detail: '逐文件决定，两边不同的内容不会自动覆盖'
  }
];
</script>

<template>
  <section class="restore-block" aria-labelledby="restore-plan-title">
    <h4 id="restore-plan-title" class="restore-heading">恢复计划</h4>
    <ul class="restore-stats">
      <li
        v-for="stat in stats"
        :key="stat.key"
        class="restore-stat"
        :class="{ 'is-risk': stat.key === 'conflict' && stat.value > 0 }"
      >
        <strong>{{ stat.value }}</strong
        ><span>{{ stat.label }}</span>
      </li>
    </ul>
    <p v-if="wizard.plan.emptyDirectories.length" class="restore-note">
      <span class="i-mingcute-folder-line size-4 shrink-0" aria-hidden="true" />
      归档里还有 {{ wizard.plan.emptyDirectories.length }} 个空目录，会一并建出来
    </p>
    <p v-if="!wizard.plan.identityMatches" class="restore-note is-blocked" role="alert">
      <span class="i-mingcute-lock-line size-4 shrink-0" aria-hidden="true" />
      这份归档不能自证是当前作品（缺少 chaptale.json 或身份不符），只能恢复到新目录
    </p>
  </section>
  <section class="restore-block" aria-labelledby="restore-mode-title">
    <h4 id="restore-mode-title" class="restore-heading">恢复方式</h4>
    <RadioGroupRoot
      class="restore-modes"
      :model-value="wizard.mode"
      aria-labelledby="restore-mode-title"
      :disabled="cloud.isApplying"
      @update:model-value="cloud.setRestoreMode($event as CloudRestoreMode)"
    >
      <RadioGroupItem
        v-for="mode in modes"
        :key="mode.value"
        :value="mode.value"
        class="restore-mode"
        :class="{ 'is-active': wizard.mode === mode.value }"
        :disabled="cloud.isApplying || (mode.value !== 'new' && !wizard.plan.identityMatches)"
        :aria-label="mode.title"
      >
        <span class="restore-mode-head">
          <span :class="mode.icon" class="size-4 shrink-0" aria-hidden="true" />
          <strong>{{ mode.title }}</strong>
          <span v-if="wizard.mode === mode.value" class="i-mingcute-check-line size-4 shrink-0" aria-hidden="true" />
        </span>
        <span class="restore-mode-detail">{{ mode.detail }}</span>
      </RadioGroupItem>
    </RadioGroupRoot>
    <p v-if="cloud.restoreBlockedReason" class="restore-note is-blocked" role="alert">
      <span class="i-mingcute-warning-line size-4 shrink-0" aria-hidden="true" />{{ cloud.restoreBlockedReason }}
    </p>
  </section>
</template>
