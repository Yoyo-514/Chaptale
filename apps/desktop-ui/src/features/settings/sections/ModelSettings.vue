<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { DiscoveredModel, NativeModel, NativeProvider, ProviderView } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useAgentStore } from '@/features/agent';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

const apis = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' }
];

const agent = useAgentStore();
const host = () => getDesktopApi().agentHost;
const providers = ref<ProviderView[]>([]);
/** 当前编辑的已保存供应商；为空时表示新建。 */
const current = ref<ProviderView>();
const id = ref('');
const config = ref<NativeProvider>({ api: 'openai-completions', models: [] });
const apiKey = ref('');
const json = ref('');
const jsonOpen = ref(false);
const discovered = ref<DiscoveredModel[]>([]);
/** 展开中的模型条目；新手动添加的模型默认展开。 */
const expanded = ref(new Set<NativeModel>());
const loading = ref(true);
const pending = ref('');
const error = ref('');
const status = ref('');

/** IPC 只能传普通对象；JSON 往返同时去掉留空的可选字段。 */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const models = computed(() => config.value.models ?? []);
const candidates = computed(() => discovered.value.filter(item => !models.value.some(model => model.id === item.id)));
/** 正在生成内容的模型不能删除，宿主同样会拒绝。 */
const running = computed(
  () =>
    new Set(
      (agent.state?.sessions ?? [])
        .filter(session => session.running && session.model)
        .map(session => `${session.model!.provider}/${session.model!.id}`)
    )
);
const providerBusy = computed(() => [...running.value].some(key => key.startsWith(`${current.value?.id}/`)));
const modelBusy = (model: NativeModel) => running.value.has(`${current.value?.id}/${model.id}`);

function edit(provider?: ProviderView) {
  current.value = provider;
  id.value = provider?.id ?? '';
  config.value = provider ? plain(provider.config) : { api: 'openai-completions', models: [] };
  apiKey.value = '';
  discovered.value = [];
  expanded.value = new Set();
  jsonOpen.value = false;
  error.value = '';
  status.value = '';
}

async function load(select?: string) {
  providers.value = await host().request('providers', undefined);
  edit(providers.value.find(item => item.id === select) ?? providers.value[0]);
}

onMounted(async () => {
  await agent.connect();
  try {
    if (agent.connected) await load();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    loading.value = false;
  }
});

async function run(label: string, action: () => Promise<void>) {
  pending.value = label;
  error.value = '';
  status.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    pending.value = '';
  }
}

function applyJson() {
  try {
    config.value = JSON.parse(json.value);
    return true;
  } catch (cause) {
    error.value = `JSON 格式错误：${toErrorMessage(cause)}`;
    return false;
  }
}

function toggleJson(open: boolean) {
  if (open) json.value = JSON.stringify(config.value, null, 2);
  else if (!applyJson()) return;
  jsonOpen.value = open;
}

function save() {
  if (jsonOpen.value && !applyJson()) return Promise.resolve();
  return run('save', async () => {
    const saved = id.value.trim();
    await host().request('saveProvider', { id: saved, config: plain(config.value), apiKey: apiKey.value || undefined });
    await load(saved);
    status.value = '已保存，可在会话中选择。';
  });
}

function removeModel(model: NativeModel) {
  config.value.models = models.value.filter(item => item !== model);
  return save();
}

function removeProvider() {
  return run('delete', async () => {
    await host().request('deleteProvider', { id: current.value!.id });
    await load();
  });
}

function discover() {
  return run('discover', async () => {
    discovered.value = await host().request('discoverModels', {
      id: current.value?.id,
      baseUrl: config.value.baseUrl ?? '',
      api: config.value.api ?? '',
      headers: config.value.headers && plain(config.value.headers),
      apiKey: apiKey.value || undefined
    });
    if (!candidates.value.length) status.value = '没有可添加的新模型。';
  });
}

function addModels(items: DiscoveredModel[]) {
  config.value.models = [
    ...models.value,
    ...items.map(item => (item.name === item.id ? { id: item.id } : { id: item.id, name: item.name }))
  ];
}

function addManual() {
  const model = { id: '' };
  config.value.models = [...models.value, model];
  expanded.value.add(config.value.models.at(-1)!);
}

function expand(model: NativeModel, open: boolean) {
  if (open) expanded.value.add(model);
  else expanded.value.delete(model);
}

function setInput(model: NativeModel, image: boolean) {
  model.input = image ? ['text', 'image'] : ['text'];
}
</script>

<template>
  <section class="model-settings">
    <header class="agent-settings-heading">
      <h2>模型</h2>
      <p>管理供应商与模型，在会话输入区随时切换。</p>
    </header>
    <div class="model-settings-layout">
      <AppScrollArea class="model-provider-list"
        ><nav aria-label="供应商列表">
          <button
            v-for="provider in providers"
            :key="provider.id"
            type="button"
            class="model-list-item"
            :aria-current="current?.id === provider.id ? 'true' : undefined"
            @click="edit(provider)"
          >
            <span>{{ provider.id }}</span
            ><small>{{ provider.config.models?.length ?? 0 }} 个模型</small>
          </button>
          <p v-if="loading" class="agent-empty-small">正在读取模型…</p>
          <AppButton type="button" variant="ghost" :disabled="loading" @click="edit()"
            ><span class="i-mingcute-add-line size-4" aria-hidden="true" />添加供应商</AppButton
          >
        </nav></AppScrollArea
      >
      <AppForm class="model-editor" :disabled="!!pending || loading || !agent.connected" @submit="save">
        <AppScrollArea class="agent-settings-scroll" viewport-class="agent-settings-fields"
          ><div class="agent-form">
            <header class="model-editor-header">
              <h3>{{ current?.id ?? '添加供应商' }}</h3>
              <AppAlertDialog
                v-if="current"
                :title="`删除供应商“${current.id}”？`"
                description="它的所有模型会从列表中移除。已有会话的历史保留，再次发送前需要选择其他模型。"
                confirm-label="删除"
                @confirm="removeProvider"
                ><template #trigger
                  ><AppButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    :disabled="providerBusy || !!pending"
                    :title="providerBusy ? '有模型正在生成内容，结束后再删除' : undefined"
                    >删除供应商</AppButton
                  ></template
                ></AppAlertDialog
              >
            </header>
            <h4 class="model-section-title">连接</h4>
            <div class="agent-form-pair">
              <label
                >供应商标识<AppInput
                  v-model="id"
                  :readonly="!!current"
                  required
                  autocomplete="off"
                  placeholder="例如 deepseek" /></label
              ><label
                >接口类型<AppSelect
                  :model-value="config.api"
                  aria-label="接口类型"
                  @update:model-value="config.api = $event as string"
                  ><AppSelectItem
                    v-if="config.api && !apis.some(api => api.value === config.api)"
                    :value="config.api"
                    >{{ config.api }}</AppSelectItem
                  ><AppSelectItem v-for="api in apis" :key="api.value" :value="api.value">{{
                    api.label
                  }}</AppSelectItem></AppSelect
                ></label
              >
            </div>
            <label
              >服务地址<AppInput
                :model-value="config.baseUrl"
                type="url"
                placeholder="https://…"
                @update:model-value="config.baseUrl = $event || undefined"
            /></label>
            <label
              >API 密钥<AppInput
                v-model="apiKey"
                type="password"
                autocomplete="new-password"
                :placeholder="current?.hasApiKey ? '已保存，留空保持不变' : '填入供应商提供的密钥'"
            /></label>

            <header class="model-editor-header">
              <h4 class="model-section-title">模型</h4>
              <span>
                <AppButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="!config.baseUrl || !!pending"
                  @click="discover"
                  >{{ pending === 'discover' ? '正在拉取…' : '拉取模型列表' }}</AppButton
                ><AppButton type="button" variant="ghost" size="sm" @click="addManual">手动添加</AppButton>
              </span>
            </header>
            <div v-if="candidates.length" class="model-candidates" aria-label="可添加的模型">
              <AppButton
                v-for="item in candidates"
                :key="item.id"
                type="button"
                variant="outline"
                size="sm"
                @click="addModels([item])"
                ><span class="i-mingcute-add-line size-3.5" aria-hidden="true" />{{ item.name }}</AppButton
              ><AppButton type="button" variant="ghost" size="sm" @click="addModels(candidates)">全部添加</AppButton>
            </div>
            <p v-if="!models.length" class="agent-field-help">还没有模型。拉取模型列表，或手动添加模型 ID。</p>
            <AppCollapsible
              v-for="(model, index) in models"
              :key="index"
              :model-value="expanded.has(model)"
              variant="plain"
              :title="model.name || model.id || '新模型'"
              :description="model.name && model.name !== model.id ? model.id : undefined"
              class="model-row"
              @update:model-value="expand(model, $event)"
            >
              <div class="agent-form">
                <div class="agent-form-pair">
                  <label>模型 ID<AppInput v-model="model.id" required autocomplete="off" /></label
                  ><label
                    >显示名称<AppInput
                      :model-value="model.name"
                      placeholder="默认使用模型 ID"
                      @update:model-value="model.name = $event || undefined"
                  /></label>
                </div>
                <div class="agent-form-pair">
                  <label
                    >上下文长度<AppNumberInput
                      v-model="model.contextWindow"
                      aria-label="上下文长度"
                      :min="1"
                      placeholder="默认" /></label
                  ><label
                    >最大输出长度<AppNumberInput
                      v-model="model.maxTokens"
                      aria-label="最大输出长度"
                      :min="1"
                      placeholder="默认"
                  /></label>
                </div>
                <div class="model-row-footer">
                  <label class="agent-check"
                    ><AppCheckbox
                      :model-value="model.reasoning === true"
                      aria-label="支持思考"
                      @update:model-value="model.reasoning = $event === true"
                    />支持思考</label
                  ><label class="agent-check"
                    ><AppCheckbox
                      :model-value="model.input?.includes('image') === true"
                      aria-label="支持图片输入"
                      @update:model-value="setInput(model, $event === true)"
                    />支持图片输入</label
                  ><AppAlertDialog
                    :title="`删除模型“${model.name || model.id}”？`"
                    description="删除后立即保存。已有会话的历史保留。"
                    confirm-label="删除"
                    @confirm="removeModel(model)"
                    ><template #trigger
                      ><AppButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        :disabled="modelBusy(model) || !!pending"
                        :title="modelBusy(model) ? '正在生成内容，结束后再删除' : undefined"
                        >删除模型</AppButton
                      ></template
                    ></AppAlertDialog
                  >
                </div>
              </div>
            </AppCollapsible>

            <AppCollapsible
              :model-value="jsonOpen"
              variant="plain"
              title="高级配置（JSON）"
              description="请求头、接口兼容性等其他原生字段。密钥只在上方填写。"
              class="model-json"
              @update:model-value="toggleJson"
            >
              <AppTextarea
                v-model="json"
                aria-label="高级配置 JSON"
                :rows="14"
                spellcheck="false"
                class="model-json-text"
              />
            </AppCollapsible>
            <p v-if="error || (!agent.connected && agent.error)" role="alert" class="agent-error">
              {{ error || agent.error }}
            </p>
          </div></AppScrollArea
        >
        <footer class="agent-settings-footer">
          <span v-if="status" role="status">{{ status }}</span
          ><AppButton type="submit" :disabled="!!pending || loading || !agent.connected">{{
            pending === 'save' ? '正在保存…' : '保存'
          }}</AppButton>
        </footer>
      </AppForm>
    </div>
  </section>
</template>
