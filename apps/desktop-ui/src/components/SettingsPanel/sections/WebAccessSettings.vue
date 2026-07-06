<script setup lang="ts">
import type { PiWebAccessProvider, PiWebAccessSettings, PiWebAccessWorkflow } from '@chaptale/ipc-contract';
import {
  CheckboxIndicator,
  CheckboxRoot,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui';
import { computed, reactive, watch } from 'vue';

import { useNotificationStore } from '../../../stores/notification';
import { useSettingsStore } from '../../../stores/settings';
import NumberInput from '../../NumberInput/NumberInput.vue';

const settingsStore = useSettingsStore();
const notificationStore = useNotificationStore();

const providers: { value: PiWebAccessProvider; label: string; note: string }[] = [
  { value: 'auto', label: '自动选择', note: '按当前可用服务自动选择' },
  { value: 'openai', label: 'OpenAI / Codex', note: '可复用 Codex 订阅或 OpenAI Key' },
  { value: 'exa', label: 'Exa', note: '支持自带 Key；也可使用内置零配置路径' },
  { value: 'brave', label: 'Brave', note: '需要 Brave Search API Key' },
  { value: 'parallel', label: 'Parallel', note: '需要 Parallel API Key' },
  { value: 'tavily', label: 'Tavily', note: '需要 Tavily API Key' },
  { value: 'perplexity', label: 'Perplexity', note: '需要 Perplexity API Key' },
  { value: 'gemini', label: 'Gemini', note: '关联搜索模型、视频理解与浏览器 Cookie' }
];

const workflows: { value: PiWebAccessWorkflow; label: string; note: string }[] = [
  { value: 'none', label: '直接返回', note: '不打开浏览器筛选页，推荐默认' },
  { value: 'auto-summary', label: '自动总结', note: '用模型生成总结，不打开浏览器筛选页' },
  { value: 'summary-review', label: '浏览器筛选', note: '打开临时页面人工筛选来源' }
];

const draft = reactive<PiWebAccessSettings>(createFallbackSettings());
const sections = reactive({
  keys: true,
  gemini: false,
  content: true,
  advanced: false
});

watch(
  () => settingsStore.state?.settings.webAccess,
  value => {
    Object.assign(draft, normalizeSettings(value));
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
  await settingsStore.update({ webAccess: cloneSettings(draft) });
  notificationStore.success('联网能力设置已保存');
}

function resetToSafeDefaults() {
  Object.assign(draft, createFallbackSettings());
}

function normalizeSettings(value: PiWebAccessSettings | undefined): PiWebAccessSettings {
  const fallback = createFallbackSettings();
  const source = value ?? fallback;

  return {
    ...fallback,
    ...source,
    githubClone: {
      ...fallback.githubClone,
      ...source.githubClone
    },
    youtube: {
      ...fallback.youtube,
      ...source.youtube
    },
    video: {
      ...fallback.video,
      ...source.video
    },
    ssrf: source.ssrf
      ? {
          ...source.ssrf,
          allowRanges: Array.isArray(source.ssrf.allowRanges) ? source.ssrf.allowRanges : []
        }
      : undefined
  };
}

function createFallbackSettings(): PiWebAccessSettings {
  return {
    webSearchEnabled: true,
    provider: 'auto',
    workflow: 'none',
    allowBrowserCookies: false,
    curatorTimeoutSeconds: 20,
    githubClone: {
      enabled: true,
      maxRepoSizeMB: 350,
      cloneTimeoutSeconds: 30
    },
    youtube: {
      enabled: true,
      preferredModel: 'gemini-3-flash-preview'
    },
    video: {
      enabled: true,
      preferredModel: 'gemini-3-flash-preview',
      maxSizeMB: 50
    },
    ssrf: {
      allowRanges: []
    }
  };
}

function cloneSettings(value: PiWebAccessSettings): PiWebAccessSettings {
  return JSON.parse(JSON.stringify(value)) as PiWebAccessSettings;
}
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-web-access-title">
    <div class="settings-section-heading">
      <div>
        <h3 id="settings-web-access-title" class="settings-section-title">联网与内容提取</h3>
        <p class="settings-section-description">
          配置联网搜索、网页内容提取、GitHub 仓库读取，以及可选的视频内容理解能力。 API Key
          会保存在本机配置文件中，仅供桌面端运行时使用。
        </p>
      </div>
    </div>

    <div class="settings-card-grid">
      <label class="settings-switch-row">
        <CheckboxRoot
          class="settings-checkbox"
          :model-value="draft.webSearchEnabled"
          @update:model-value="draft.webSearchEnabled = $event === true"
        >
          <CheckboxIndicator class="settings-checkbox-indicator">
            <span class="i-mingcute-check-line" aria-hidden="true" />
          </CheckboxIndicator>
        </CheckboxRoot>
        <span>
          <strong>启用联网搜索</strong>
          <small>关闭后仍保留网页内容读取与已保存内容取回能力。</small>
        </span>
      </label>

      <div class="settings-field">
        <span>默认搜索 Provider</span>
        <DropdownMenuRoot>
          <DropdownMenuTrigger class="settings-dropdown-trigger plain-trigger">
            <span>{{ activeProvider?.label }}</span>
            <small>{{ activeProvider?.note }}</small>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="settings-dropdown-content" :side-offset="6" align="start">
              <DropdownMenuItem
                v-for="provider in providers"
                :key="provider.value"
                class="settings-dropdown-item"
                @select="selectProvider(provider.value)"
              >
                <span>{{ provider.label }}</span>
                <code>{{ provider.note }}</code>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>

      <div class="settings-field">
        <span>搜索工作流</span>
        <DropdownMenuRoot>
          <DropdownMenuTrigger class="settings-dropdown-trigger plain-trigger">
            <span>{{ activeWorkflow?.label }}</span>
            <small>{{ activeWorkflow?.note }}</small>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent class="settings-dropdown-content" :side-offset="6" align="start">
              <DropdownMenuItem
                v-for="workflow in workflows"
                :key="workflow.value"
                class="settings-dropdown-item"
                @select="selectWorkflow(workflow.value)"
              >
                <span>{{ workflow.label }}</span>
                <code>{{ workflow.note }}</code>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>
      </div>

      <label v-if="showCuratorOptions" class="settings-field">
        <span>浏览器筛选超时（秒）</span>
        <NumberInput v-model="draft.curatorTimeoutSeconds" :min="1" :max="600" aria-label="浏览器筛选超时秒数" />
      </label>
    </div>

    <div class="settings-warning-card">
      <strong>注意事项</strong>
      <ul>
        <li>浏览器筛选会打开临时页面；Chaptale 默认使用「直接返回」避免打断聊天流程。</li>
        <li>Gemini Web 的 Chromium Cookie 读取是敏感能力，只有显式开启时才允许。</li>
        <li>
          视频转录/视觉描述可以启用；逐帧截图、缩略图、部分 YouTube 帧提取属于可选增强，取决于用户本机是否已有 ffmpeg 与
          yt-dlp。
        </li>
        <li>环境变量（如 BRAVE_API_KEY、TAVILY_API_KEY）优先级高于此配置文件。</li>
      </ul>
    </div>

    <CollapsibleRoot v-model:open="sections.keys" class="settings-reka-section">
      <CollapsibleTrigger class="settings-reka-trigger">
        <span>
          <strong>API Keys</strong>
          <small>只展示当前 Provider 或自动模式可能用到的 Key。</small>
        </span>
        <span :class="['i-mingcute-down-line settings-reka-chevron', sections.keys && 'is-open']" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent class="settings-reka-content">
        <div class="settings-form-grid">
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'openai')" class="settings-field"
            ><span>OpenAI API Key</span><input v-model="draft.openaiApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'brave')" class="settings-field"
            ><span>Brave API Key</span><input v-model="draft.braveApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'exa')" class="settings-field"
            ><span>Exa API Key</span><input v-model="draft.exaApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'parallel')" class="settings-field"
            ><span>Parallel API Key</span><input v-model="draft.parallelApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'tavily')" class="settings-field"
            ><span>Tavily API Key</span><input v-model="draft.tavilyApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'perplexity')" class="settings-field"
            ><span>Perplexity API Key</span><input v-model="draft.perplexityApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="visibleKeyProviders.some(provider => provider.value === 'gemini')" class="settings-field"
            ><span>Gemini API Key</span><input v-model="draft.geminiApiKey" type="password" autocomplete="off"
          /></label>
          <label v-if="usesGeminiFeatures" class="settings-field"
            ><span>Cloudflare AI Gateway Key</span
            ><input v-model="draft.cloudflareApiKey" type="password" autocomplete="off"
          /></label>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>

    <CollapsibleRoot v-if="usesGeminiFeatures" v-model:open="sections.gemini" class="settings-reka-section">
      <CollapsibleTrigger class="settings-reka-trigger">
        <span>
          <strong>Gemini 与浏览器 Cookie</strong>
          <small>Gemini 搜索、视频理解或 Gemini Web 相关设置。</small>
        </span>
        <span
          :class="['i-mingcute-down-line settings-reka-chevron', sections.gemini && 'is-open']"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="settings-reka-content">
        <div class="settings-form-grid">
          <label class="settings-field wide"
            ><span>Gemini Base URL</span
            ><input v-model="draft.geminiBaseUrl" placeholder="https://my-gateway.example.com/gemini"
          /></label>
          <div v-if="showBrowserCookieOptions" class="settings-toggle-group wide">
            <label class="settings-switch-row">
              <CheckboxRoot
                class="settings-checkbox"
                :model-value="draft.allowBrowserCookies"
                @update:model-value="draft.allowBrowserCookies = $event === true"
              >
                <CheckboxIndicator class="settings-checkbox-indicator">
                  <span class="i-mingcute-check-line" aria-hidden="true" />
                </CheckboxIndicator>
              </CheckboxRoot>
              <span>
                <strong>允许读取浏览器 Cookie</strong>
                <small>用于 Gemini Web；可能触发系统钥匙串/凭据提示。</small>
              </span>
            </label>
            <div v-if="draft.allowBrowserCookies" class="settings-nested-fields single">
              <label class="settings-field"
                ><span>Chrome Profile</span><input v-model="draft.chromeProfile" placeholder="Profile 2"
              /></label>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>

    <CollapsibleRoot v-model:open="sections.content" class="settings-reka-section">
      <CollapsibleTrigger class="settings-reka-trigger">
        <span>
          <strong>内容能力</strong>
          <small>GitHub 仓库读取、视频理解与模型偏好。</small>
        </span>
        <span
          :class="['i-mingcute-down-line settings-reka-chevron', sections.content && 'is-open']"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent class="settings-reka-content">
        <div class="settings-form-grid">
          <label v-if="draft.provider === 'gemini'" class="settings-field"
            ><span>Search Model</span><input v-model="draft.searchModel" placeholder="gemini-2.5-flash"
          /></label>
          <label v-if="showSummaryOptions" class="settings-field"
            ><span>Summary Model</span><input v-model="draft.summaryModel" placeholder="anthropic/claude-haiku-4-5"
          /></label>

          <div class="settings-toggle-group wide">
            <label class="settings-switch-row">
              <CheckboxRoot
                class="settings-checkbox"
                :model-value="draft.githubClone.enabled"
                @update:model-value="draft.githubClone.enabled = $event === true"
              >
                <CheckboxIndicator class="settings-checkbox-indicator">
                  <span class="i-mingcute-check-line" aria-hidden="true" />
                </CheckboxIndicator>
              </CheckboxRoot>
              <span><strong>GitHub 克隆</strong><small>GitHub 仓库 URL 会克隆后读取真实文件。</small></span>
            </label>
            <div v-if="draft.githubClone.enabled" class="settings-nested-fields">
              <label class="settings-field"
                ><span>最大仓库大小（MB）</span
                ><NumberInput v-model="draft.githubClone.maxRepoSizeMB" :min="1" aria-label="最大仓库大小 MB"
              /></label>
              <label class="settings-field"
                ><span>克隆超时（秒）</span
                ><NumberInput v-model="draft.githubClone.cloneTimeoutSeconds" :min="1" aria-label="克隆超时秒数"
              /></label>
              <label class="settings-field wide"
                ><span>克隆目录</span
                ><input
                  v-model="draft.githubClone.clonePath"
                  placeholder="留空使用系统临时目录：%TEMP%/pi-github-repos（Windows）或 /tmp/pi-github-repos（Linux/macOS）"
              /></label>
            </div>
          </div>

          <div class="settings-toggle-group wide">
            <label class="settings-switch-row">
              <CheckboxRoot
                class="settings-checkbox"
                :model-value="draft.youtube.enabled"
                @update:model-value="draft.youtube.enabled = $event === true"
              >
                <CheckboxIndicator class="settings-checkbox-indicator">
                  <span class="i-mingcute-check-line" aria-hidden="true" />
                </CheckboxIndicator>
              </CheckboxRoot>
              <span><strong>YouTube 理解</strong><small>用于视频转录和视觉描述；逐帧提取只作为可选增强。</small></span>
            </label>
            <div v-if="draft.youtube.enabled" class="settings-nested-fields single">
              <label class="settings-field"
                ><span>YouTube Preferred Model</span
                ><input v-model="draft.youtube.preferredModel" placeholder="gemini-3-flash-preview"
              /></label>
            </div>
          </div>

          <div class="settings-toggle-group wide">
            <label class="settings-switch-row">
              <CheckboxRoot
                class="settings-checkbox"
                :model-value="draft.video.enabled"
                @update:model-value="draft.video.enabled = $event === true"
              >
                <CheckboxIndicator class="settings-checkbox-indicator">
                  <span class="i-mingcute-check-line" aria-hidden="true" />
                </CheckboxIndicator>
              </CheckboxRoot>
              <span><strong>本地视频理解</strong><small>启用本地视频分析入口，不默认要求安装额外二进制。</small></span>
            </label>
            <div v-if="draft.video.enabled" class="settings-nested-fields">
              <label class="settings-field"
                ><span>Video Preferred Model</span
                ><input v-model="draft.video.preferredModel" placeholder="gemini-3-flash-preview"
              /></label>
              <label class="settings-field"
                ><span>视频最大大小（MB）</span
                ><NumberInput v-model="draft.video.maxSizeMB" :min="1" aria-label="视频最大大小 MB"
              /></label>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>

    <div class="settings-actions">
      <button
        class="settings-secondary-button"
        type="button"
        :disabled="settingsStore.isLoading"
        @click="resetToSafeDefaults"
      >
        恢复安全默认值
      </button>
      <button class="settings-primary-button" type="button" :disabled="settingsStore.isLoading" @click="save">
        保存联网设置
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.settings-section {
  @apply p-2;

  background: var(--surface-acrylic-subtle);
}

.settings-section-heading {
  @apply flex items-center justify-between gap-3;
}

.settings-section-title {
  @apply m-0 text-sm font-semibold;
}

.settings-section-description {
  @apply mt-1 mb-3 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-warning-card,
.settings-card-grid,
.settings-reka-section {
  @apply border;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
}

.settings-warning-card,
.settings-card-grid,
.settings-reka-content {
  @apply mt-2 p-3;
}

.settings-warning-card strong {
  @apply m-0 text-xs font-semibold;
}

.settings-warning-card ul {
  @apply my-2 pl-4 text-xs leading-5;

  color: var(--muted-foreground);
}

.settings-card-grid,
.settings-form-grid {
  @apply grid gap-2;
}

.settings-form-grid {
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}

.settings-reka-section {
  @apply mt-2 overflow-hidden;
}

.settings-reka-trigger {
  @apply flex w-full items-center justify-between gap-3 px-3 py-2 text-left outline-none transition-colors duration-150;

  background: transparent;
}

.settings-reka-trigger:hover {
  background: var(--surface-muted);
}

.settings-reka-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-reka-trigger span:first-child {
  @apply flex min-w-0 flex-col gap-1;
}

.settings-reka-trigger strong {
  @apply text-xs font-semibold;
}

.settings-reka-trigger small {
  @apply text-xs;

  color: var(--muted-foreground);
}

.settings-reka-chevron {
  @apply shrink-0 text-muted-foreground transition-transform duration-150;
}

.settings-reka-chevron.is-open {
  @apply rotate-180;
}

.settings-field,
.settings-switch-row {
  @apply flex min-w-0 gap-2;
}

.settings-field {
  @apply flex-col;
}

.settings-field.wide,
.settings-toggle-group.wide {
  grid-column: 1 / -1;
}

.settings-toggle-group {
  @apply min-w-0;
}

.settings-switch-row {
  @apply items-start py-2;
}

.settings-switch-row > span {
  @apply flex min-w-0 flex-col gap-1 text-xs;
}

.settings-nested-fields {
  @apply mt-1 grid gap-2 border-l pl-6;

  border-color: var(--border-subtle);
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
}

.settings-nested-fields.single {
  grid-template-columns: minmax(0, 1fr);
}

.settings-switch-row small,
.settings-field > span {
  @apply text-xs;

  color: var(--muted-foreground);
}

.settings-checkbox {
  @apply flex-center mt-0.5 size-4 shrink-0 border outline-none transition-colors duration-150;

  background: var(--input);
  border-color: var(--input-border);
  border-radius: calc(var(--radius) * 0.25);
}

.settings-checkbox[data-state='checked'] {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.settings-checkbox:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-checkbox-indicator {
  @apply flex-center text-xs;
}

.settings-field input {
  @apply min-w-0 border px-2 py-1.5 text-xs outline-none;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.4);
  color: var(--foreground);
}

.settings-field input:focus {
  box-shadow: var(--input-focus-shadow);
}

.settings-dropdown-trigger {
  @apply flex min-w-0 flex-col gap-0.5 border px-2 py-1.5 text-left text-xs outline-none transition-colors duration-150;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.4);
  color: var(--foreground);
}

.settings-dropdown-trigger:hover {
  background: var(--secondary);
}

.settings-dropdown-trigger:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.settings-dropdown-trigger small {
  @apply truncate text-[0.68rem];

  color: var(--muted-foreground);
}

:global(.settings-dropdown-content) {
  @apply z-50 flex max-h-[16rem] min-w-64 flex-col gap-1 overflow-y-auto border p-1 shadow-float;

  width: var(--reka-dropdown-menu-trigger-width, var(--radix-dropdown-menu-trigger-width, 24rem));
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--popover-foreground);
}

:global(.settings-dropdown-item) {
  @apply flex cursor-pointer flex-col gap-0.5 px-2 py-1.5 text-xs outline-none;

  border-radius: calc(var(--radius) * 0.4);
}

:global(.settings-dropdown-item[data-highlighted]) {
  background: var(--surface-muted);
}

:global(.settings-dropdown-item code) {
  @apply break-all text-[0.68rem];

  color: var(--muted-foreground);
}

.settings-actions {
  @apply mt-3 flex flex-wrap justify-end gap-2;
}

.settings-primary-button,
.settings-secondary-button {
  @apply border px-3 py-1.5 text-xs font-medium outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60;

  border-radius: calc(var(--radius) * 0.5);
}

.settings-primary-button {
  background: var(--primary-solid);
  border-color: var(--primary-solid);
  color: var(--primary-solid-foreground);
}

.settings-primary-button:hover:not(:disabled) {
  background: var(--primary-solid-hover);
}

.settings-secondary-button {
  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.settings-secondary-button:hover:not(:disabled) {
  background: var(--secondary);
}

.settings-primary-button:focus-visible,
.settings-secondary-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}
</style>
