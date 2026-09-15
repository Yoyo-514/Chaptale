<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';

import { AUTO_BACKUP_INTERVAL_MINUTES } from '@chaptale/ipc-contract';

import { AppCheckbox } from '@/components/AppCheckbox';
import { AppNumberInput } from '@/components/AppNumberInput';
import { useSettingsStore } from '@/features/settings';

import { describeBackupInterval, formatWhen, isValidBackupInterval } from '../presentation';
import { useCloudSyncStore } from '../store';

const cloud = useCloudSyncStore();
const settings = useSettingsStore();
const hintId = useId();
const autoBackupEnabled = computed({
  get: () => settings.state?.settings.backup?.auto ?? true,
  set: (value: boolean) => void settings.update({ backup: { auto: value } })
});
const intervalDraft = ref<number>();
watch(
  () => settings.state?.settings.backup?.intervalMinutes,
  value => {
    intervalDraft.value = isValidBackupInterval(value) ? value : AUTO_BACKUP_INTERVAL_MINUTES.default;
  },
  { immediate: true }
);
function changeInterval(value: number | undefined) {
  intervalDraft.value = value;
  if (isValidBackupInterval(value)) void settings.update({ backup: { intervalMinutes: value } });
}
const intervalHint = computed(() =>
  isValidBackupInterval(intervalDraft.value)
    ? describeBackupInterval(intervalDraft.value)
    : `请填 ${AUTO_BACKUP_INTERVAL_MINUTES.min} 到 ${AUTO_BACKUP_INTERVAL_MINUTES.max} 之间的整数分钟`
);
const intervalInvalid = computed(
  () => typeof intervalDraft.value === 'number' && !isValidBackupInterval(intervalDraft.value)
);
</script>

<template>
  <div class="cloud-auto">
    <label class="cloud-auto-row">
      <AppCheckbox v-model="autoBackupEnabled" aria-label="自动备份" /><span>自动备份</span>
    </label>
    <div class="cloud-auto-row">
      <span>每隔</span>
      <AppNumberInput
        :model-value="intervalDraft"
        class="cloud-auto-interval"
        :min="AUTO_BACKUP_INTERVAL_MINUTES.min"
        :max="AUTO_BACKUP_INTERVAL_MINUTES.max"
        :disabled="!autoBackupEnabled"
        :invalid="intervalInvalid"
        :aria-describedby="hintId"
        aria-label="自动备份间隔（分钟）"
        @update:model-value="changeInterval"
      />
      <span>分钟</span>
      <span :id="hintId" class="cloud-muted" :class="{ 'cloud-error': intervalInvalid }">{{ intervalHint }}</span>
    </div>
    <p class="cloud-muted">
      自动备份仅在应用与这部作品打开时执行；正在备份或恢复时跳过。
      {{ cloud.lastBackupAt ? `本机上次备份 ${formatWhen(cloud.lastBackupAt)}` : '本机还没备份过' }}。
    </p>
    <p v-if="cloud.lastBackupError" class="cloud-error" role="alert">
      上次自动备份失败：{{ cloud.lastBackupError.message }}（{{ formatWhen(cloud.lastBackupError.at) }}）
    </p>
  </div>
</template>
