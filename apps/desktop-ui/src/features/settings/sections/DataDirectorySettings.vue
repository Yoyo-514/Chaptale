<script setup lang="ts">
import { onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppNotice } from '@/components/AppNotice';

import SettingsPathCard from '../components/SettingsPathCard.vue';
import SettingsSection from '../components/SettingsSection.vue';
import { useSettingsStore } from '../store';
import { useDataDirectoryStore } from '../store/data-directory';

const settings = useSettingsStore();
const directory = useDataDirectoryStore();
onMounted(() => {
  void directory.load();
  if (!settings.state) void settings.load();
});
</script>

<template>
  <SettingsSection
    title="应用数据"
    title-id="settings-data-title"
    description="作品和会话历史保存在数据文件夹。更换位置不会搬动已有数据，重启后打开新位置里的作品。"
  >
    <div class="data-settings">
      <SettingsPathCard
        label="数据文件夹"
        :value="directory.status?.kind === 'ready' ? directory.status.path : undefined"
        emphasis
      />
      <div class="data-settings-actions">
        <AppButton variant="outline" :disabled="directory.busy" @click="directory.pickAndChoose()">更换位置</AppButton>
      </div>
      <AppNotice v-if="directory.error" tone="error">{{ directory.error }}</AppNotice>
      <AppNotice
        v-if="directory.status?.kind === 'ready' && directory.status.next"
        tone="info"
        class="data-settings-next"
      >
        已改为 {{ directory.status.next }}。退出并重新打开 Chaptale 后生效，当前仍在使用上面的文件夹。
      </AppNotice>
      <SettingsPathCard label="应用配置（模型、凭据与设置）" :value="settings.state?.paths.rootDir" />
      <div class="data-settings-actions">
        <AppButton variant="outline" @click="settings.openConfigDir">打开应用配置目录</AppButton>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped lang="scss">
.data-settings {
  @apply flex flex-col gap-3;
}

.data-settings-actions {
  @apply flex gap-2;
}

.data-settings-next {
  overflow-wrap: anywhere;
}
</style>
