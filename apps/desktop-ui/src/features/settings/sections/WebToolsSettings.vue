<script setup lang="ts">
import { reactive } from 'vue';

import type { WebToolsProvider } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppForm, AppFormActions, AppFormField, AppFormGrid } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import SettingsSection from '../components/SettingsSection.vue';
import SettingsToggleField from '../components/SettingsToggleField.vue';
import { useWebToolsSettingsState } from '../composables/useWebToolsSettingsState';

const { providers, draft, isLoading, activeProvider, selectProvider, save, resetToDefaults } =
  useWebToolsSettingsState();

const sections = reactive({ keys: false, advanced: false });
</script>

<template>
  <SettingsSection
    title="联网与内容提取"
    title-id="settings-web-tools-title"
    description="配置联网搜索与网页内容抓取。DuckDuckGo 无需任何配置即可使用；API Key 保存在本机配置文件中，仅供桌面端运行时使用。"
  >
    <AppForm class="web-tools-form" @submit="save">
      <div class="web-tools-card">
        <SettingsToggleField
          v-model="draft.search.enabled"
          title="启用联网搜索"
          description="关闭后 web_search 工具会提示已离线；网页抓取与缓存检索不受影响。"
        />

        <AppFormField label="搜索 Provider">
          <template #default="{ controlAttrs }">
            <AppSelect
              v-bind="controlAttrs"
              :model-value="draft.search.provider"
              class="web-tools-select"
              size="sm"
              variant="muted"
              @update:model-value="selectProvider($event as WebToolsProvider)"
            >
              <template #trigger="{ triggerClass, disabled, dataDisabled }">
                <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
                  <span>{{ activeProvider?.label }}</span>
                  <span class="web-tools-select-note">{{ activeProvider?.note }}</span>
                </button>
              </template>
              <AppSelectItem v-for="provider in providers" :key="provider.value" :value="provider.value">
                <span>{{ provider.label }}</span>
                <span class="web-tools-option-note">{{ provider.note }}</span>
              </AppSelectItem>
            </AppSelect>
          </template>
        </AppFormField>
      </div>

      <AppCollapsible
        v-model="sections.keys"
        title="API Keys"
        description="按所选 Provider 填写；DuckDuckGo 无需 Key。"
      >
        <div class="web-tools-card">
          <AppFormGrid>
            <AppFormField v-if="draft.search.provider === 'brave'" label="Brave Search API Key">
              <template #default="{ controlAttrs }">
                <AppInput v-bind="controlAttrs" v-model="draft.keys.braveApiKey" type="password" autocomplete="off" />
              </template>
            </AppFormField>

            <AppFormField v-if="draft.search.provider === 'tavily'" label="Tavily API Key">
              <template #default="{ controlAttrs }">
                <AppInput v-bind="controlAttrs" v-model="draft.keys.tavilyApiKey" type="password" autocomplete="off" />
              </template>
            </AppFormField>

            <AppFormField v-if="draft.search.provider === 'exa'" label="Exa API Key">
              <template #default="{ controlAttrs }">
                <AppInput v-bind="controlAttrs" v-model="draft.keys.exaApiKey" type="password" autocomplete="off" />
              </template>
            </AppFormField>

            <AppFormField v-if="draft.search.provider === 'duckduckgo'" label="无需 API Key">
              <template #default="{ controlAttrs }">
                <AppInput v-bind="controlAttrs" :model-value="'开箱即用，无需填写任何 Key'" disabled readonly />
              </template>
            </AppFormField>
          </AppFormGrid>
        </div>
      </AppCollapsible>

      <AppCollapsible v-model="sections.advanced" title="高级选项" description="抓取限制与内网放行规则。">
        <div class="web-tools-card">
          <AppFormGrid>
            <AppFormField label="抓取超时（秒）">
              <template #default="{ controlAttrs }">
                <AppNumberInput v-bind="controlAttrs" v-model="draft.fetch.timeoutSeconds" :min="1" :max="300" />
              </template>
            </AppFormField>

            <AppFormField label="正文大小上限（MB）">
              <template #default="{ controlAttrs }">
                <AppNumberInput
                  v-bind="controlAttrs"
                  :model-value="Math.round(draft.fetch.maxBytes / 1024 / 1024)"
                  :min="1"
                  :max="64"
                  @update:model-value="draft.fetch.maxBytes = ($event ?? 1) * 1024 * 1024"
                />
              </template>
            </AppFormField>

            <AppFormField label="SSRF 放行网段（CIDR，逗号分隔）">
              <template #default="{ controlAttrs }">
                <AppInput
                  v-bind="controlAttrs"
                  placeholder="例如 10.1.0.0/16；留空表示阻止全部内网地址"
                  :model-value="draft.ssrf.allowRanges.join(',')"
                  @update:model-value="
                    draft.ssrf.allowRanges = String($event ?? '')
                      .split(',')
                      .map(s => s.trim())
                      .filter(Boolean)
                  "
                />
              </template>
            </AppFormField>
          </AppFormGrid>
        </div>
      </AppCollapsible>

      <AppFormActions>
        <AppButton type="submit" variant="primary" :disabled="isLoading">保存</AppButton>
        <AppButton type="button" variant="ghost" :disabled="isLoading" @click="resetToDefaults">恢复默认</AppButton>
      </AppFormActions>
    </AppForm>
  </SettingsSection>
</template>

<style scoped lang="scss">
.web-tools-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.web-tools-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--app-border-muted);
  border-radius: 12px;
}

.web-tools-select {
  width: 100%;
}

.web-tools-select-note,
.web-tools-option-note {
  color: var(--app-text-tertiary);
  font-size: 12px;
}
</style>
