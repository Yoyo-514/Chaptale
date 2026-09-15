<script setup lang="ts">
import { CLOUD_PROVIDER_LABELS } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';

import { formatSize, formatWhen } from '../presentation';
import { useCloudSyncStore } from '../store';
import BackupArchives from './BackupArchives.vue';
import BackupSchedule from './BackupSchedule.vue';

const cloud = useCloudSyncStore();
</script>

<template>
  <section class="cloud-section" aria-labelledby="cloud-backup-title">
    <div class="cloud-heading">
      <h4 id="cloud-backup-title">作品备份</h4>
      <div class="cloud-actions">
        <AppButton
          v-if="cloud.binding"
          :disabled="cloud.isBackupRunning || cloud.isApplying"
          @click="cloud.createBackup()"
        >
          <span class="i-mingcute-cloud-line size-4" aria-hidden="true" />立即备份
        </AppButton>
        <AppButton
          icon
          variant="ghost"
          aria-label="刷新云端备份"
          :disabled="cloud.isBackupLoading"
          @click="cloud.loadBackups()"
        >
          <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />
        </AppButton>
      </div>
    </div>
    <p v-if="cloud.isBackupRunning" class="cloud-pending" role="status">{{ cloud.progressLabel }}</p>
    <template v-if="cloud.binding">
      <p class="cloud-path">
        {{ cloud.binding.folderName }}
        <span class="cloud-muted">
          · {{ CLOUD_PROVIDER_LABELS[cloud.binding.provider] }} · 绑定于 {{ formatWhen(cloud.binding.boundAt) }}
        </span>
      </p>
      <p class="cloud-muted">
        {{
          cloud.quota
            ? `云端占用 ${formatSize(cloud.quota.usedBytes)} / ${formatSize(cloud.quota.totalBytes)}`
            : '云端配额：服务商未提供'
        }}
      </p>
      <BackupSchedule />
      <BackupArchives />
      <div class="cloud-actions is-end">
        <AppButton variant="ghost" :disabled="cloud.isBackupRunning || cloud.isApplying" @click="cloud.unbind()"
          >解除绑定</AppButton
        >
      </div>
    </template>
    <p v-else class="cloud-muted">这部作品还没有绑定云端备份位置。绑定仅保存在本机，解除绑定不会删除云端归档。</p>
    <p v-if="cloud.backupError" class="cloud-error" role="alert">{{ cloud.backupError }}</p>
    <p v-if="cloud.notice" class="cloud-notice" role="status">{{ cloud.notice }}</p>
  </section>
</template>
