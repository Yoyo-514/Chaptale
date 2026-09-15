<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';

import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { useWorkspaceStore } from '@/features/workspace';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import CloudAccounts from './components/CloudAccounts.vue';
import CloudBackups from './components/CloudBackups.vue';
import CloudFolderBrowser from './components/CloudFolderBrowser.vue';
import RestoreWizard from './RestoreWizard.vue';
import { useCloudSyncStore } from './store';

const cloud = useCloudSyncStore();
const workspace = useWorkspaceStore();
watch(
  () => [workspace.rootPath, workspace.revision],
  () => {
    if (hasDesktopApi()) void cloud.refreshCloud();
  }
);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  if (!hasDesktopApi()) return;
  void cloud.load();
  void cloud.loadBackups();
  unsubscribe = getDesktopApi().cloudSync.onBackupProgress(progress => cloud.applyProgress(progress));
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <SettingsSection
    title="云端备份"
    title-id="settings-cloud-sync-title"
    description="凭据经系统密钥环加密后只保存在本机，账户密码不下发到界面。"
  >
    <div class="cloud-sync">
      <CloudAccounts />
      <CloudFolderBrowser />
      <CloudBackups />
    </div>
  </SettingsSection>
  <RestoreWizard />
</template>

<style lang="scss">
@use './styles/settings';
</style>
