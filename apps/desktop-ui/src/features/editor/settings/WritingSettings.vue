<script setup lang="ts">
import { computed } from 'vue';

import { SettingsSectionView as SettingsSection, SettingsToggleField, useSettingsStore } from '@/features/settings';

import { useEditorStore } from '../store';
const settings = useSettingsStore();
const editor = useEditorStore();
const autoSave = computed(() => settings.state?.settings.editor?.autoSave ?? false);
</script>
<template>
  <SettingsSection
    title="写作"
    title-id="settings-writing-title"
    description="正文与资料保存在本机作品库。每次正式保存记录修订，未保存输入另存恢复草稿。"
    ><SettingsToggleField
      :model-value="autoSave"
      title="自动保存"
      description="停止输入后保存正文；关闭时使用 Ctrl+S 手动保存。"
      :disabled="settings.isLoading"
      @update:model-value="editor.setAutoSave"
  /></SettingsSection>
</template>
