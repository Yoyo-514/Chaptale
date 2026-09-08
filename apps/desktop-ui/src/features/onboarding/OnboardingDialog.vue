<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { ChaptaleTheme } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTabs } from '@/components/AppTabs';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { APP_ICON_URL } from '@/utils/app-icon';

import { ONBOARDING_VERSION, useOnboardingStore } from './store';

const guide = useOnboardingStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const navigation = useWorkbenchStore();
const destination = ref('new');
const theme = ref<ChaptaleTheme>('dark');
const autoSave = ref(false);
const busy = ref(false);
const error = ref('');
const steps = [
  { value: 'workspace', label: '作品' },
  { value: 'environment', label: '写作环境' },
  { value: 'assistant', label: 'AI 助手' }
];
const titles: Record<string, string> = {
  new: '新建作品',
  open: '打开作品',
  current: '继续创作',
  empty: '进入工作台'
};
const stepIndex = computed(() => steps.findIndex(item => item.value === guide.step));
const selectedModel = computed(() => {
  const selected = settings.models?.defaultModel;
  return selected
    ? (settings.models?.models.find(model => model.provider === selected.provider && model.id === selected.modelId)
        ?.name ?? selected.modelId)
    : '未配置';
});
const completion = () => ({
  completedVersion: Math.max(ONBOARDING_VERSION, settings.state?.settings.onboarding?.completedVersion ?? 0)
});
watch(
  () => settings.state,
  state => {
    if (state) guide.consider(state.settings.onboarding?.completedVersion);
  },
  { immediate: true }
);
watch(
  () => guide.isOpen,
  open => {
    if (!open) return;
    error.value = '';
    theme.value = settings.state?.settings.theme ?? 'dark';
    autoSave.value = settings.state?.settings.editor?.autoSave ?? false;
    destination.value = settings.state?.settings.storage.mode === 'workspace' ? 'current' : 'new';
    if (!settings.models && !settings.isModelsLoading) void settings.loadModels();
  },
  { immediate: true }
);
onMounted(() => {
  if (!settings.state && !settings.isLoading) void settings.load();
});
async function skip() {
  if (busy.value) return;
  guide.isOpen = false;
  await settings.update({ onboarding: completion() });
}
async function finish(section?: 'llm' | 'content') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (
      !(await settings.update({ onboarding: completion(), theme: theme.value, editor: { autoSave: autoSave.value } }))
    ) {
      error.value = settings.error || '设置未保存，请重试或跳过';
      return;
    }
    guide.isOpen = false;
    await nextTick();
    if (section) {
      settings.openPanel(section);
    } else {
      navigation.center = 'editor';
      if (destination.value === 'new') workspace.newWorkspaceOpen = true;
      else if (destination.value === 'open') await workspace.openWorkspace();
      else if (workspace.rootPath) navigation.showSidebar('workspace');
    }
  } finally {
    busy.value = false;
  }
}
function next() {
  if (stepIndex.value === steps.length - 1) void finish();
  else guide.step = steps[stepIndex.value + 1]!.value;
}
</script>

<template>
  <AppDialog :open="guide.isOpen" title="开始创作" close-label="跳过开始引导" @update:open="value => !value && skip()">
    <div class="onboarding">
      <div class="onboarding-brand">
        <img :src="APP_ICON_URL" alt="" width="40" height="40" />
        <span>Chaptale</span>
        <span class="onboarding-step">{{ stepIndex + 1 }} / {{ steps.length }}</span>
      </div>
      <AppTabs v-model="guide.step" :items="steps" label="开始引导步骤">
        <AppScrollArea class="onboarding-scroll">
          <section v-if="guide.step === 'workspace'" class="onboarding-section" aria-label="作品起点">
            <h3>作品起点</h3>
            <label
              >开始于
              <AppSelect v-model="destination" aria-label="作品起点">
                <AppSelectItem value="new">新建作品</AppSelectItem>
                <AppSelectItem value="open">打开已有作品</AppSelectItem>
                <AppSelectItem v-if="workspace.rootPath" value="current">继续当前作品</AppSelectItem>
                <AppSelectItem value="empty">暂不打开作品</AppSelectItem>
              </AppSelect>
            </label>
            <dl>
              <div>
                <dt>当前作品</dt>
                <dd>{{ workspace.displayName || '尚未打开' }}</dd>
              </div>
              <div v-if="workspace.rootPath">
                <dt>文件位置</dt>
                <dd>{{ workspace.rootPath }}</dd>
              </div>
              <div>
                <dt>保存方式</dt>
                <dd>本地文件</dd>
              </div>
            </dl>
          </section>
          <section v-else-if="guide.step === 'environment'" class="onboarding-section" aria-label="写作环境">
            <h3>写作环境</h3>
            <label
              >主题
              <AppSelect v-model="theme" aria-label="引导主题">
                <AppSelectItem value="light"
                  ><span class="onboarding-swatch is-light" aria-hidden="true" />浅色</AppSelectItem
                >
                <AppSelectItem value="warm"
                  ><span class="onboarding-swatch is-warm" aria-hidden="true" />暖色</AppSelectItem
                >
                <AppSelectItem value="dark"
                  ><span class="onboarding-swatch is-dark" aria-hidden="true" />深色</AppSelectItem
                >
              </AppSelect>
            </label>
            <label class="onboarding-check"><AppCheckbox v-model="autoSave" />自动保存正文</label>
          </section>
          <section v-else class="onboarding-section" aria-label="可选 AI 配置">
            <h3>AI 助手 <span class="onboarding-optional">可选</span></h3>
            <dl>
              <div>
                <dt>默认模型</dt>
                <dd>{{ selectedModel }}</dd>
              </div>
            </dl>
            <div class="onboarding-commands">
              <AppButton :disabled="busy" @click="finish('llm')"
                ><span class="i-mingcute-settings-3-line" aria-hidden="true" />配置模型</AppButton
              >
              <AppButton :disabled="busy" @click="finish('content')"
                ><span class="i-mingcute-user-setting-line" aria-hidden="true" />管理专员</AppButton
              >
            </div>
          </section>
        </AppScrollArea>
      </AppTabs>
      <p v-if="error" class="onboarding-error" role="alert">{{ error }}</p>
      <footer>
        <AppButton variant="ghost" :disabled="busy" @click="skip">跳过</AppButton>
        <span class="onboarding-spacer" />
        <AppButton v-if="stepIndex > 0" :disabled="busy" @click="guide.step = steps[stepIndex - 1]!.value">
          <span class="i-mingcute-left-line" aria-hidden="true" />上一步
        </AppButton>
        <AppButton variant="primary" :disabled="busy" @click="next">
          {{ stepIndex === steps.length - 1 ? titles[destination] : '下一步' }}
          <span class="i-mingcute-right-line" aria-hidden="true" />
        </AppButton>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped lang="scss">
.onboarding {
  @apply flex min-h-0 flex-col gap-4 pt-4;
  font-size: var(--ui-font-size);
  height: min(390px, calc(100vh - 160px));
}
.onboarding-brand {
  @apply flex shrink-0 items-center gap-3;
  font-size: 20px;
  font-weight: 600;
}
.onboarding-brand img {
  object-fit: contain;
}
.onboarding-step {
  @apply ml-auto font-normal;
  color: var(--muted-foreground);
  font-size: var(--ui-font-size);
}
.onboarding-scroll {
  @apply min-h-0 flex-1;
}
.onboarding-section {
  @apply grid gap-4 py-4 pr-3;
}
h3 {
  @apply m-0 text-base font-medium;
}
label {
  @apply grid gap-2;
}
.onboarding-check {
  @apply flex items-center gap-2;
}
dl {
  @apply m-0 grid gap-3;
}
dl > div {
  @apply grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3;
}
dt,
.onboarding-optional {
  color: var(--muted-foreground);
}
dd {
  @apply m-0;
  overflow-wrap: anywhere;
}
.onboarding-optional {
  @apply ml-2 font-normal;
  font-size: var(--ui-font-size);
}
.onboarding-commands,
footer {
  @apply flex shrink-0 flex-wrap items-center gap-2;
}
.onboarding-spacer {
  @apply flex-1;
}
.onboarding-swatch {
  @apply mr-2 inline-block size-3.5 shrink-0 border align-middle;
  border-color: var(--input-border);
  border-radius: 2px;
}
.is-light {
  background: #f8fbfd;
}
.is-warm {
  background: #f7f3e8;
}
.is-dark {
  background: #142d39;
}
.onboarding-error {
  @apply m-0;
  color: var(--destructive);
  overflow-wrap: anywhere;
}
</style>
