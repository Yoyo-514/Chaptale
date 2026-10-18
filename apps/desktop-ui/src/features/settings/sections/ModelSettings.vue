<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import type { ProviderInput, ProviderSummary } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useAgentStore } from '@/features/agent';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

const agent = useAgentStore();
const models = ref<ProviderSummary[]>([]);
const sourceProvider = ref<string>();
const editing = ref(false);
const saving = ref(false);
const loading = ref(true);
const error = ref('');
const saved = ref(false);
const form = reactive({
  provider: '',
  baseUrl: '',
  api: 'openai-completions',
  modelId: '',
  modelName: '',
  contextWindow: undefined as number | undefined,
  maxTokens: undefined as number | undefined,
  reasoning: false,
  apiKey: ''
});
const apis = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' }
] as const;
const supported = computed(() => apis.some(item => item.value === form.api));
const providers = computed(() => [...new Set(models.value.map(item => item.provider))]);
function select(item: ProviderSummary) {
  Object.assign(form, item, { apiKey: '' });
  sourceProvider.value = item.provider;
  editing.value = true;
  saved.value = false;
}
function addProvider() {
  Object.assign(form, {
    provider: '',
    baseUrl: '',
    api: 'openai-completions',
    modelId: '',
    modelName: '',
    contextWindow: undefined,
    maxTokens: undefined,
    reasoning: false,
    apiKey: ''
  });
  sourceProvider.value = undefined;
  editing.value = false;
  saved.value = false;
}
function addModel(item: ProviderSummary) {
  select(item);
  Object.assign(form, { modelId: '', modelName: '', contextWindow: undefined, maxTokens: undefined, reasoning: false });
  editing.value = false;
}
onMounted(async () => {
  await agent.connect();
  try {
    if (agent.connected) {
      models.value = await getDesktopApi().agentHost.request('configuredModels', undefined);
      if (models.value.length) select(models.value[0]);
    }
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    loading.value = false;
  }
});
async function save() {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    await getDesktopApi().agentHost.request('configure', {
      ...form,
      api: form.api as ProviderInput['api'],
      apiKey: form.apiKey || undefined,
      contextWindow: Number(form.contextWindow),
      maxTokens: Number(form.maxTokens)
    });
    models.value = await getDesktopApi().agentHost.request('configuredModels', undefined);
    select(models.value.find(item => item.provider === form.provider && item.modelId === form.modelId)!);
    agent.selectedModel = { provider: form.provider, id: form.modelId };
    saved.value = true;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="model-settings">
    <header class="agent-settings-heading">
      <h2>模型</h2>
      <p>管理连接与模型，在会话输入区随时切换。</p>
    </header>
    <div class="model-settings-layout">
      <AppScrollArea class="model-provider-list"
        ><nav aria-label="模型配置列表">
          <AppButton type="button" variant="ghost" :disabled="loading" @click="addProvider"
            ><span class="i-mingcute-add-line size-4" aria-hidden="true" />添加供应商</AppButton
          >
          <p v-if="loading" class="agent-empty-small">正在读取模型…</p>
          <section v-for="provider in providers" :key="provider" class="model-provider-group">
            <header>
              <h3>{{ provider }}</h3>
              <AppButton
                type="button"
                icon
                size="sm"
                variant="ghost"
                :aria-label="`为 ${provider} 添加模型`"
                title="添加模型"
                @click="addModel(models.find(item => item.provider === provider)!)"
                ><span class="i-mingcute-add-line size-4" aria-hidden="true"
              /></AppButton>
            </header>
            <button
              v-for="item in models.filter(item => item.provider === provider)"
              :key="item.modelId"
              type="button"
              class="model-list-item"
              :aria-current="
                editing && form.provider === item.provider && form.modelId === item.modelId ? 'true' : undefined
              "
              @click="select(item)"
            >
              <span>{{ item.modelName }}</span
              ><small>{{ item.modelId }}</small>
            </button>
          </section>
        </nav></AppScrollArea
      >
      <AppForm class="model-editor" :disabled="saving || loading || !agent.connected" @submit="save">
        <AppScrollArea class="agent-settings-scroll" viewport-class="agent-settings-fields"
          ><div class="agent-form">
            <h3>{{ editing ? form.modelName : sourceProvider ? '添加模型' : '添加供应商与模型' }}</h3>
            <h4 class="model-section-title">连接</h4>
            <div class="agent-form-pair">
              <label
                >供应商标识<AppInput
                  v-model="form.provider"
                  :readonly="!!sourceProvider"
                  required
                  autocomplete="off"
                  placeholder="例如 deepseek" /></label
              ><label
                >接口类型<AppSelect v-model="form.api" aria-label="接口类型"
                  ><AppSelectItem v-if="!supported" :value="form.api" disabled>{{ form.api }}</AppSelectItem
                  ><AppSelectItem v-for="api in apis" :key="api.value" :value="api.value">{{
                    api.label
                  }}</AppSelectItem></AppSelect
                ></label
              >
            </div>
            <label>服务地址<AppInput v-model="form.baseUrl" type="url" required placeholder="https://…" /></label>
            <label
              >API 密钥<AppInput
                v-model="form.apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="sourceProvider ? '留空保留已有密钥' : '填入供应商提供的密钥'"
            /></label>
            <p class="agent-field-help">同一供应商下的模型共用连接设置。</p>
            <h4 class="model-section-title">模型</h4>
            <div class="agent-form-pair">
              <label>模型 ID<AppInput v-model="form.modelId" :readonly="editing" required autocomplete="off" /></label
              ><label>显示名称<AppInput v-model="form.modelName" required placeholder="会话中显示的名称" /></label>
            </div>
            <div class="agent-form-pair">
              <label
                >上下文长度<AppNumberInput
                  v-model="form.contextWindow"
                  aria-label="上下文长度"
                  :min="1"
                  required
                  placeholder="token 数" /></label
              ><label
                >最大输出长度<AppNumberInput
                  v-model="form.maxTokens"
                  aria-label="最大输出长度"
                  :min="1"
                  :max="form.contextWindow"
                  required
                  placeholder="token 数"
              /></label>
            </div>
            <label class="agent-check"
              ><AppCheckbox
                :model-value="form.reasoning"
                aria-label="支持思考"
                @update:model-value="form.reasoning = $event === true"
              />支持思考</label
            >
            <p v-if="error || (!agent.connected && agent.error)" role="alert" class="agent-error">
              {{ error || agent.error }}
            </p>
          </div></AppScrollArea
        >
        <footer class="agent-settings-footer">
          <span v-if="saved" role="status">已保存，可在会话中选择。</span
          ><AppButton type="submit" :disabled="saving || loading || !agent.connected || !supported">{{
            saving ? '正在保存…' : '保存模型'
          }}</AppButton>
        </footer>
      </AppForm>
    </div>
  </section>
</template>
