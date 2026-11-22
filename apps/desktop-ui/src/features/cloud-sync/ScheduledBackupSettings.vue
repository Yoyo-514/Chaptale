<script setup lang="ts">
import { onMounted } from 'vue';

import { SCHEDULED_BACKUP_INTERVALS, type ScheduledBackupInterval } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppNotice } from '@/components/AppNotice';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppSwitch } from '@/components/AppSwitch';
import { SettingsPathCard, SettingsSectionView as SettingsSection } from '@/features/settings';

import { formatWhen } from './presentation';
import { useScheduledBackupStore } from './scheduled-backup-store';

const backup = useScheduledBackupStore();
const intervalLabels: Record<ScheduledBackupInterval, string> = { 10: '10 分钟', 30: '30 分钟', 60: '1 小时' };

onMounted(() => void backup.load());
</script>

<template>
  <SettingsSection
    title="备份"
    title-id="settings-backup-title"
    description="应用打开期间按间隔检查，作品有改动才保存一份作品包，每部作品保留最近 10 份。登录云端账户后同时上传。"
  >
    <div v-if="backup.state" class="scheduled-backup">
      <div class="scheduled-backup-row">
        <div class="scheduled-backup-copy">
          <strong id="scheduled-backup-title">作品定时备份</strong>
          <span>{{
            backup.state.lastBackupAt ? `上次备份：${formatWhen(backup.state.lastBackupAt)}` : '还没有备份'
          }}</span>
        </div>
        <AppSelect
          :model-value="String(backup.state.settings.intervalMinutes)"
          :disabled="backup.busy"
          aria-label="检查间隔"
          @update:model-value="backup.update({ intervalMinutes: Number($event) as ScheduledBackupInterval })"
        >
          <AppSelectItem v-for="minutes in SCHEDULED_BACKUP_INTERVALS" :key="minutes" :value="String(minutes)">
            每 {{ intervalLabels[minutes] }}
          </AppSelectItem>
        </AppSelect>
        <AppSwitch
          :model-value="backup.state.settings.enabled"
          :disabled="backup.busy"
          aria-labelledby="scheduled-backup-title"
          @update:model-value="backup.update({ enabled: $event })"
        />
      </div>
      <SettingsPathCard label="备份文件夹" :value="backup.state.settings.directory" placeholder="尚未选择" />
      <div class="scheduled-backup-actions">
        <AppButton variant="outline" :disabled="backup.busy" @click="backup.chooseDirectory()">更换文件夹</AppButton>
        <AppButton variant="ghost" :disabled="!backup.state.settings.directory" @click="backup.openDirectory()">
          打开文件夹
        </AppButton>
      </div>
      <AppNotice v-if="backup.state.folderError" tone="error">{{ backup.state.folderError }}</AppNotice>
    </div>
    <AppNotice v-if="backup.error" tone="error">{{ backup.error }}</AppNotice>
  </SettingsSection>
</template>

<style scoped lang="scss">
.scheduled-backup {
  @apply flex min-w-0 flex-col gap-3;
}

.scheduled-backup-row {
  @apply flex min-w-0 flex-wrap items-center gap-3;
}

.scheduled-backup-copy {
  @apply flex flex-1 flex-col gap-1;

  min-width: 12rem;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);

  strong {
    color: var(--foreground);
    font-size: var(--ui-font-size);
    font-weight: 600;
  }
}

.scheduled-backup-actions {
  @apply flex gap-2;
}
</style>
