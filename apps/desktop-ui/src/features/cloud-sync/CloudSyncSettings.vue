<script setup lang="ts">
import { onMounted } from 'vue';

import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { hasDesktopApi } from '@/utils/desktop-api';

import CloudAccounts from './components/CloudAccounts.vue';
import CloudFolderBrowser from './components/CloudFolderBrowser.vue';
import { useCloudSyncStore } from './store';
const cloud = useCloudSyncStore();
onMounted(() => {
  if (hasDesktopApi()) void cloud.load();
});
</script>
<template>
  <SettingsSection
    title="云端账户"
    title-id="settings-cloud-sync-title"
    description="登录 Dropbox 或 OneDrive。凭据经系统密钥环加密后保存在本机。"
    ><div class="cloud-sync"><CloudAccounts /><CloudFolderBrowser /></div
  ></SettingsSection>
</template>
<style lang="scss">
@use './styles/settings';
</style>
