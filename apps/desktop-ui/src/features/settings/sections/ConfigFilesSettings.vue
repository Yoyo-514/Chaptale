<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';

import SettingsPathCard from '../components/SettingsPathCard.vue';
import SettingsSection from '../components/SettingsSection.vue';
import { useSettingsStore } from '../store';

const settingsStore = useSettingsStore();
const paths = computed(() => settingsStore.state?.paths);
</script>

<template>
  <SettingsSection
    title="配置文件"
    title-id="settings-files-title"
    description="这里用于排查本机配置路径。通常无需手动编辑，除非需要备份、迁移或排查模型配置问题。"
  >
    <template #actions>
      <AppButton type="button" @click="settingsStore.openConfigDir()">打开配置目录</AppButton>
    </template>

    <div class="settings-path-grid">
      <SettingsPathCard label="应用设置文件" :value="paths?.settingsPath" />
      <SettingsPathCard label="agent 设置文件" :value="paths?.piSettingsPath" />
      <SettingsPathCard label="第三方模型配置文件" :value="paths?.piModelsPath" />
      <SettingsPathCard label="内置模型 API Key 配置文件" :value="paths?.piAuthPath" />
      <SettingsPathCard label="联网能力配置文件" :value="paths?.piWebAccessConfigPath" />
    </div>
  </SettingsSection>
</template>

<style scoped lang="scss">
@use '../styles/controls';

.settings-path-grid {
  @apply grid gap-2;
}
</style>
