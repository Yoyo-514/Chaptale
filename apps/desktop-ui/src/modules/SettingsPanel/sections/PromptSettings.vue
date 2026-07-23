<script setup lang="ts">
import { onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppForm, AppFormActions, AppFormField } from '@/components/AppForm';
import { AppTextarea } from '@/components/AppTextarea';
import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';

import SettingsSection from '../components/SettingsSection.vue';
import { usePromptSettingsDraft } from '../composables/usePromptSettingsDraft';

const settingsStore = useSettingsStore();
const notificationStore = useNotificationStore();
const {
  draft,
  isSystemPromptBlank,
  hasChanges,
  canSave,
  discardChanges,
  restoreDefaultSystemPrompt,
  clearAppendSystemPrompt,
  save
} = usePromptSettingsDraft();

onMounted(() => {
  void settingsStore.loadPromptSettings();
});

async function savePromptSettings() {
  if (await save()) {
    notificationStore.success('Prompt 设置已保存，将从下一次请求开始生效');
  }
}
</script>

<template>
  <SettingsSection
    title="Prompt 自定义"
    title-id="settings-prompt-title"
    description="编辑用户级 SYSTEM.md 与 APPEND_SYSTEM.md。内容会随请求发送给模型提供商，请勿填写密钥。"
  >
    <AppForm class="prompt-settings-form" :disabled="settingsStore.isPromptLoading" @submit="savePromptSettings">
      <div v-if="!settingsStore.promptSettings" class="settings-empty-card">正在读取 Prompt 文件…</div>

      <template v-else>
        <AppFormField
          label="System Prompt"
          :error="isSystemPromptBlank ? 'System Prompt 不能为空' : undefined"
          description="完整基础提示词。保存后写入 SYSTEM.md；恢复默认只修改当前草稿，需要再次保存。"
        >
          <template #default="{ controlAttrs }">
            <AppTextarea
              v-bind="controlAttrs"
              v-model="draft.systemPrompt"
              class="prompt-settings-editor"
              variant="muted"
              :rows="18"
              resize="vertical"
              spellcheck="false"
            />
          </template>
        </AppFormField>

        <div class="prompt-settings-inline-actions">
          <AppButton type="button" :disabled="settingsStore.isPromptLoading" @click="restoreDefaultSystemPrompt">
            恢复默认 System Prompt
          </AppButton>
          <code>{{ settingsStore.promptSettings.systemPromptPath }}</code>
        </div>

        <AppFormField
          label="Append System Prompt"
          description="可选追加提示词。保存后写入 APPEND_SYSTEM.md，会追加到基础提示词后面。"
        >
          <template #default="{ controlAttrs }">
            <AppTextarea
              v-bind="controlAttrs"
              v-model="draft.appendSystemPrompt"
              class="prompt-settings-editor prompt-settings-editor-append"
              variant="muted"
              :rows="8"
              resize="vertical"
              spellcheck="false"
            />
          </template>
        </AppFormField>

        <div class="prompt-settings-inline-actions">
          <AppButton
            type="button"
            :disabled="settingsStore.isPromptLoading || !draft.appendSystemPrompt"
            @click="clearAppendSystemPrompt"
          >
            清空追加提示词
          </AppButton>
          <code>{{ settingsStore.promptSettings.appendSystemPromptPath }}</code>
        </div>

        <AppFormActions>
          <template #leading>
            <span class="prompt-settings-status">{{ hasChanges ? '有未保存修改' : '已保存' }}</span>
          </template>
          <AppButton type="button" :disabled="settingsStore.isPromptLoading || !hasChanges" @click="discardChanges">
            放弃修改
          </AppButton>
          <AppButton variant="primary" type="submit" :disabled="settingsStore.isPromptLoading || !canSave">
            保存 Prompt 设置
          </AppButton>
        </AppFormActions>
      </template>
    </AppForm>
  </SettingsSection>
</template>

<style scoped lang="scss">
.prompt-settings-form {
  @apply flex min-w-0 flex-col gap-3;
}

.prompt-settings-editor {
  min-height: 18rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.prompt-settings-editor-append {
  min-height: 9rem;
}

.prompt-settings-inline-actions {
  @apply flex min-w-0 items-center justify-between gap-3;
}

.prompt-settings-inline-actions code {
  @apply min-w-0 truncate text-[0.68rem];

  color: var(--muted-foreground);
}

.prompt-settings-status {
  @apply text-xs;

  color: var(--muted-foreground);
}
</style>
