<script setup lang="ts">
import type { PiWebAccessProvider, PiWebAccessSettings, PiWebAccessWorkflow } from '@chaptale/ipc-contract';
import { klona } from 'klona';
import { computed, reactive, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppForm, AppFormActions, AppFormField, AppFormGrid } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useNotificationStore } from '@/stores/notification';
import { useSettingsStore } from '@/stores/settings';
import SettingsSection from '../components/SettingsSection.vue';
import SettingsToggleField from '../components/SettingsToggleField.vue';
import {
  createDefaultWebAccessSettings,
  normalizeWebAccessSettings,
  webAccessProviders,
  webAccessWorkflows
} from '../utils/web-access-settings';

const settingsStore = useSettingsStore();
const notificationStore = useNotificationStore();

const providers = webAccessProviders;
const workflows = webAccessWorkflows;

const draft = reactive<PiWebAccessSettings>(createDefaultWebAccessSettings());
const sections = reactive({
  keys: true,
  gemini: false,
  content: true
});

watch(
  () => settingsStore.state?.webAccess,
  value => {
    Object.assign(draft, normalizeWebAccessSettings(value));
  },
  { immediate: true }
);

const showCuratorOptions = computed(() => draft.workflow === 'summary-review');
const showSummaryOptions = computed(() => draft.workflow !== 'none');
const usesGeminiFeatures = computed(() => draft.provider === 'gemini' || draft.youtube.enabled || draft.video.enabled);
const showBrowserCookieOptions = computed(() => usesGeminiFeatures.value);
const activeProvider = computed(() => providers.find(provider => provider.value === draft.provider));
const activeWorkflow = computed(() => workflows.find(workflow => workflow.value === draft.workflow));
const visibleKeyProviders = computed(() =>
  providers.filter(provider => provider.value !== 'auto' && isProviderKeyVisible(provider.value))
);

function isProviderKeyVisible(provider: Exclude<PiWebAccessProvider, 'auto'>) {
  if (draft.provider === 'auto' || draft.provider === provider) {
    return true;
  }

  return provider === 'gemini' && usesGeminiFeatures.value;
}

function selectProvider(provider: PiWebAccessProvider) {
  draft.provider = provider;
}

function selectWorkflow(workflow: PiWebAccessWorkflow) {
  draft.workflow = workflow;
}

async function save() {
  await settingsStore.updateWebAccess(klona(draft));
  notificationStore.success('联网能力设置已保存');
}

function resetToSafeDefaults() {
  Object.assign(draft, createDefaultWebAccessSettings());
}
</script>

<template>
  <SettingsSection
    title="联网与内容提取"
    title-id="settings-web-access-title"
    description="配置联网搜索、网页内容提取、GitHub 仓库读取，以及可选的视频内容理解能力。 API Key 会保存在本机配置文件中，仅供桌面端运行时使用。"
  >
    <AppForm class="web-access-form" @submit="save">
      <div class="web-access-card">
        <SettingsToggleField
          v-model="draft.webSearchEnabled"
          title="启用联网搜索"
          description="关闭后仍保留网页内容读取与已保存内容取回能力。"
        />

        <AppFormField label="默认搜索 Provider">
          <template #default="{ controlAttrs }">
            <AppSelect
              v-bind="controlAttrs"
              :model-value="draft.provider"
              class="web-access-select"
              size="sm"
              variant="muted"
              @update:model-value="selectProvider($event as PiWebAccessProvider)"
            >
              <template #trigger="{ triggerClass, disabled, dataDisabled }">
                <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
                  <span>{{ activeProvider?.label }}</span>
                  <span class="web-access-select-note">{{ activeProvider?.note }}</span>
                </button>
              </template>
              <AppSelectItem v-for="provider in providers" :key="provider.value" :value="provider.value">
                <span>{{ provider.label }}</span>
                <span class="web-access-option-note">{{ provider.note }}</span>
              </AppSelectItem>
            </AppSelect>
          </template>
        </AppFormField>

        <AppFormField label="搜索工作流">
          <template #default="{ controlAttrs }">
            <AppSelect
              v-bind="controlAttrs"
              :model-value="draft.workflow"
              class="web-access-select"
              size="sm"
              variant="muted"
              @update:model-value="selectWorkflow($event as PiWebAccessWorkflow)"
            >
              <template #trigger="{ triggerClass, disabled, dataDisabled }">
                <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
                  <span>{{ activeWorkflow?.label }}</span>
                  <span class="web-access-select-note">{{ activeWorkflow?.note }}</span>
                </button>
              </template>
              <AppSelectItem v-for="workflow in workflows" :key="workflow.value" :value="workflow.value">
                <span>{{ workflow.label }}</span>
                <span class="web-access-option-note">{{ workflow.note }}</span>
              </AppSelectItem>
            </AppSelect>
          </template>
        </AppFormField>

        <AppFormField v-if="showCuratorOptions" label="浏览器筛选超时（秒）">
          <template #default="{ controlAttrs }">
            <AppNumberInput v-bind="controlAttrs" v-model="draft.curatorTimeoutSeconds" :min="1" :max="600" />
          </template>
        </AppFormField>
      </div>

      <div class="web-access-warning-card">
        <strong>注意事项</strong>
        <ul>
          <li>浏览器筛选会打开临时页面；Chaptale 默认使用「直接返回」避免打断聊天流程。</li>
          <li>Gemini Web 的 Chromium Cookie 读取是敏感能力，只有显式开启时才允许。</li>
          <li>
            视频转录/视觉描述可以启用；逐帧截图、缩略图、部分 YouTube 帧提取属于可选增强，取决于用户本机是否已有 ffmpeg
            与 yt-dlp。
          </li>
          <li>环境变量（如 BRAVE_API_KEY、TAVILY_API_KEY）优先级高于此配置文件。</li>
        </ul>
      </div>

      <AppCollapsible
        v-model="sections.keys"
        title="API Keys"
        description="只展示当前 Provider 或自动模式可能用到的 API Key。"
      >
        <AppFormGrid>
          <AppFormField v-if="visibleKeyProviders.some(provider => provider.value === 'openai')" label="OpenAI API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.openaiApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField v-if="visibleKeyProviders.some(provider => provider.value === 'brave')" label="Brave API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.braveApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField v-if="visibleKeyProviders.some(provider => provider.value === 'exa')" label="Exa API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.exaApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField
            v-if="visibleKeyProviders.some(provider => provider.value === 'parallel')"
            label="Parallel API Key"
          >
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.parallelApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField v-if="visibleKeyProviders.some(provider => provider.value === 'tavily')" label="Tavily API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.tavilyApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField
            v-if="visibleKeyProviders.some(provider => provider.value === 'perplexity')"
            label="Perplexity API Key"
          >
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.perplexityApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField v-if="visibleKeyProviders.some(provider => provider.value === 'gemini')" label="Gemini API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.geminiApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
          <AppFormField v-if="usesGeminiFeatures" label="Cloudflare AI Gateway API Key">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.cloudflareApiKey"
                variant="muted"
                type="password"
                autocomplete="off"
              />
            </template>
          </AppFormField>
        </AppFormGrid>
      </AppCollapsible>

      <AppCollapsible
        v-if="usesGeminiFeatures"
        v-model="sections.gemini"
        title="Gemini 与浏览器 Cookie"
        description="Gemini 搜索、视频理解或 Gemini Web 相关设置。"
      >
        <AppFormGrid>
          <AppFormField label="Gemini Base URL" span="full">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.geminiBaseUrl"
                variant="muted"
                placeholder="https://my-gateway.example.com/gemini"
              />
            </template>
          </AppFormField>

          <SettingsToggleField
            v-if="showBrowserCookieOptions"
            v-model="draft.allowBrowserCookies"
            title="允许读取浏览器 Cookie"
            description="用于 Gemini Web；可能触发系统钥匙串/凭据提示。"
            wide
            :content-columns="1"
          >
            <AppFormField label="Chrome Profile">
              <template #default="{ controlAttrs }">
                <AppInput v-bind="controlAttrs" v-model="draft.chromeProfile" variant="muted" placeholder="Profile 2" />
              </template>
            </AppFormField>
          </SettingsToggleField>
        </AppFormGrid>
      </AppCollapsible>

      <AppCollapsible v-model="sections.content" title="内容能力" description="GitHub 仓库读取、视频理解与模型偏好。">
        <AppFormGrid>
          <AppFormField v-if="draft.provider === 'gemini'" label="Search Model">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.searchModel"
                variant="muted"
                placeholder="gemini-2.5-flash"
              />
            </template>
          </AppFormField>

          <AppFormField v-if="showSummaryOptions" label="Summary Model">
            <template #default="{ controlAttrs }">
              <AppInput
                v-bind="controlAttrs"
                v-model="draft.summaryModel"
                variant="muted"
                placeholder="anthropic/claude-haiku-4-5"
              />
            </template>
          </AppFormField>

          <SettingsToggleField
            v-model="draft.githubClone.enabled"
            title="GitHub 克隆"
            description="GitHub 仓库 URL 会克隆后读取真实文件。"
            wide
          >
            <AppFormField label="最大仓库大小（MB）">
              <template #default="{ controlAttrs }">
                <AppNumberInput v-bind="controlAttrs" v-model="draft.githubClone.maxRepoSizeMB" :min="1" />
              </template>
            </AppFormField>
            <AppFormField label="克隆超时（秒）">
              <template #default="{ controlAttrs }">
                <AppNumberInput v-bind="controlAttrs" v-model="draft.githubClone.cloneTimeoutSeconds" :min="1" />
              </template>
            </AppFormField>
            <AppFormField label="克隆目录" span="full">
              <template #default="{ controlAttrs }">
                <AppInput
                  v-bind="controlAttrs"
                  v-model="draft.githubClone.clonePath"
                  variant="muted"
                  placeholder="留空使用系统临时目录：%TEMP%/pi-github-repos（Windows）或 /tmp/pi-github-repos（Linux/macOS）"
                />
              </template>
            </AppFormField>
          </SettingsToggleField>

          <SettingsToggleField
            v-model="draft.youtube.enabled"
            title="YouTube 理解"
            description="用于视频转录和视觉描述；逐帧提取只作为可选增强。"
            wide
            :content-columns="1"
          >
            <AppFormField label="YouTube Preferred Model">
              <template #default="{ controlAttrs }">
                <AppInput
                  v-bind="controlAttrs"
                  v-model="draft.youtube.preferredModel"
                  variant="muted"
                  placeholder="gemini-3-flash-preview"
                />
              </template>
            </AppFormField>
          </SettingsToggleField>

          <SettingsToggleField
            v-model="draft.video.enabled"
            title="本地视频理解"
            description="启用本地视频分析入口，不默认要求安装额外二进制。"
            wide
          >
            <AppFormField label="Video Preferred Model">
              <template #default="{ controlAttrs }">
                <AppInput
                  v-bind="controlAttrs"
                  v-model="draft.video.preferredModel"
                  variant="muted"
                  placeholder="gemini-3-flash-preview"
                />
              </template>
            </AppFormField>
            <AppFormField label="视频最大大小（MB）">
              <template #default="{ controlAttrs }">
                <AppNumberInput v-bind="controlAttrs" v-model="draft.video.maxSizeMB" :min="1" />
              </template>
            </AppFormField>
          </SettingsToggleField>
        </AppFormGrid>
      </AppCollapsible>

      <AppFormActions>
        <AppButton type="button" :disabled="settingsStore.isLoading" @click="resetToSafeDefaults">
          恢复安全默认值
        </AppButton>
        <AppButton variant="primary" type="submit" :disabled="settingsStore.isLoading"> 保存联网设置 </AppButton>
      </AppFormActions>
    </AppForm>
  </SettingsSection>
</template>

<style lang="scss">
.web-access-form {
  @apply flex min-w-0 flex-col gap-2;
}

.web-access-card,
.web-access-warning-card {
  @apply border p-3;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.web-access-card {
  @apply flex min-w-0 flex-col gap-2;
}

.web-access-warning-card strong {
  @apply m-0 text-xs font-semibold;
}

.web-access-warning-card ul {
  @apply my-2 pl-4 text-xs leading-5;

  color: var(--muted-foreground);
}

.web-access-select {
  @apply flex-col items-start gap-0.5 text-left;
}

.web-access-select:hover {
  background: var(--secondary);
}

.web-access-select-note,
.web-access-option-note {
  @apply max-w-full truncate text-[0.68rem] leading-4;

  color: var(--muted-foreground);
}

.app-select-item[data-state='checked'] .web-access-option-note,
.app-select-item[data-highlighted] .web-access-option-note {
  color: var(--secondary-foreground);
  opacity: 0.78;
}
</style>
