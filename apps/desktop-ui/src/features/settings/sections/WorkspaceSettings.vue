<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useSessionStore } from '@/features/sessions';
import { useWorkspaceStore } from '@/features/workspace';

import SettingsPathCard from '../components/SettingsPathCard.vue';
import SettingsSection from '../components/SettingsSection.vue';
import SettingsToggleField from '../components/SettingsToggleField.vue';
import { useSettingsStore } from '../store';

const settingsStore = useSettingsStore();
const sessionStore = useSessionStore();
const workspaceStore = useWorkspaceStore();

const state = computed(() => settingsStore.state);
const workspacePath = computed(() => state.value?.settings.workspace.path ?? '');
const paths = computed(() => state.value?.paths);
const showInternalFiles = computed(() => state.value?.settings.explorer?.showInternalFiles ?? false);

// 作品切换顺带刷新会话目录信息：这里显示的是"现在写到哪"，不能停在上一部作品。
async function openWorkspace() {
  await workspaceStore.openWorkspace();
  await sessionStore.loadStorageDebugInfo();
}

async function closeWorkspace() {
  await workspaceStore.closeWorkspace();
  await sessionStore.loadStorageDebugInfo();
}

async function setShowInternalFiles(value: boolean) {
  await settingsStore.update({ explorer: { showInternalFiles: value } });
}
</script>

<template>
  <SettingsSection
    class="workspace-settings"
    title="作品与会话存储"
    title-id="settings-storage-title"
    description="会话按作品目录隔离保存；没有打开作品时不能开始新的对话。"
  >
    <template #badge>
      <span class="settings-pill">{{ workspacePath ? '已打开作品' : '未打开作品' }}</span>
    </template>

    <SettingsPathCard
      label="当前作品"
      :value="workspacePath || '尚未打开作品'"
      emphasis
      class="settings-path-card-spacing"
    />

    <SettingsPathCard
      v-if="paths?.effectiveSessionDir"
      label="当前会话目录"
      :value="paths.effectiveSessionDir"
      class="settings-path-card-spacing"
    />

    <div class="settings-actions">
      <AppButton type="button" :disabled="settingsStore.isLoading" @click="openWorkspace">打开作品…</AppButton>
      <AppButton v-if="workspacePath" type="button" :disabled="settingsStore.isLoading" @click="closeWorkspace">
        关闭作品
      </AppButton>
    </div>
    <section class="workspace-explorer-settings" aria-labelledby="settings-explorer-title">
      <h4 id="settings-explorer-title">资源管理器</h4>
      <SettingsToggleField
        :model-value="showInternalFiles"
        title="显示内部文件"
        description="展示 .chaptale/ 等应用数据目录；日常写作不需要看到它们。"
        :disabled="settingsStore.isLoading"
        @update:model-value="setShowInternalFiles"
      />
    </section>
  </SettingsSection>
</template>

<style scoped lang="scss">
@use '../styles/controls';

.workspace-explorer-settings {
  @apply mt-6 border-t pt-4;
  border-color: var(--border-subtle);
}
.workspace-explorer-settings h4 {
  @apply m-0 mb-3 text-sm font-semibold;
}

.settings-pill {
  @apply shrink-0 text-xs;
  color: var(--muted-foreground);
}

.settings-actions {
  @apply flex flex-wrap gap-2 pt-3;
}

.settings-path-card-spacing {
  @apply mb-2;
}
</style>
