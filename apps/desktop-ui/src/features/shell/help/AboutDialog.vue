<script setup lang="ts">
import { onMounted, ref, shallowRef, useId } from 'vue';

import type { AppAboutInfo } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppNotice } from '@/components/AppNotice';
import { AppSwitch } from '@/components/AppSwitch';
import { useSettingsStore } from '@/features/settings';
import { APP_ICON_URL } from '@/utils/app-icon';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

const emit = defineEmits<{ close: [] }>();
const settings = useSettingsStore();
const info = shallowRef<AppAboutInfo>();
const error = ref('');
const copied = ref(false);
const updateId = useId();
const updateHintId = useId();

onMounted(async () => {
  try {
    info.value = await getDesktopApi().help.getAbout();
  } catch (cause) {
    error.value = `读取版本信息失败：${toErrorMessage(cause)}`;
  }
});

async function copyVersion(text: string) {
  error.value = '';
  copied.value = false;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
  } catch (cause) {
    error.value = `复制版本信息失败：${toErrorMessage(cause)}`;
  }
}
</script>

<template>
  <AppDialog :open="true" title="关于 Chaptale" content-size="sm" @update:open="emit('close')">
    <div class="about-body">
      <div v-if="info" class="about-product">
        <img :src="APP_ICON_URL" alt="" />
        <strong>版本 {{ info.version }}</strong>
      </div>
      <AppNotice v-else-if="!error">正在读取版本信息…</AppNotice>
      <div class="about-update">
        <div>
          <label :for="updateId">启动时检查更新</label>
          <p :id="updateHintId">打开 Chaptale 时向 GitHub 查询最新发布。</p>
        </div>
        <AppSwitch
          v-if="settings.state"
          :id="updateId"
          :model-value="settings.state.settings.checkUpdatesOnStartup"
          :disabled="settings.isLoading"
          :aria-describedby="updateHintId"
          @update:model-value="settings.update({ checkUpdatesOnStartup: $event })"
        />
      </div>
      <AppNotice v-if="error" tone="error">{{ error }}</AppNotice>
    </div>
    <div v-if="info" class="about-actions">
      <span v-if="copied" role="status">已复制到剪贴板</span>
      <AppButton variant="outline" @click="copyVersion(info.versionText)">复制版本信息</AppButton>
    </div>
  </AppDialog>
</template>

<style scoped lang="scss">
.about-body {
  @apply mt-3 min-h-0 overflow-y-auto px-1;
  font-size: var(--ui-font-size);
}
.about-product {
  @apply flex items-center gap-3 pb-3;
}
.about-product img {
  @apply size-10 shrink-0;
}
.about-product strong {
  @apply text-base font-semibold tabular-nums;
}
.about-update {
  @apply flex items-center justify-between gap-3 border-t py-3;
  border-color: var(--border-subtle);
}
.about-update label {
  @apply font-medium;
}
.about-update p {
  @apply mb-0 mt-1;
}
.about-update p,
.about-actions span {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.about-actions {
  @apply flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-3;
  border-color: var(--border-subtle);
}
</style>
