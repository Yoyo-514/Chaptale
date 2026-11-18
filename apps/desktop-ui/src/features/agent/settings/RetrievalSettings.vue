<script setup lang="ts">
import { onMounted, ref } from 'vue';

import type { EmbeddingSettingsSave, EmbeddingSettingsView } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useAgentStore } from '../store';

const agent = useAgentStore();
const host = () => getDesktopApi().agentHost;
const saved = ref<EmbeddingSettingsView | null>(null);
const baseUrl = ref('');
const apiKey = ref('');
const model = ref('');
const dimensions = ref<number>();
const loading = ref(true);
const pending = ref('');
const error = ref('');
const status = ref('');

function show(settings: EmbeddingSettingsView | null) {
  saved.value = settings;
  baseUrl.value = settings?.baseUrl ?? '';
  model.value = settings?.model ?? '';
  dimensions.value = settings?.dimensions ?? undefined;
  apiKey.value = '';
}

function form(): EmbeddingSettingsSave {
  return {
    baseUrl: baseUrl.value,
    model: model.value,
    dimensions: dimensions.value ?? null,
    apiKey: apiKey.value || undefined
  };
}

onMounted(async () => {
  await agent.connect();
  try {
    if (agent.connected) show(await host().request('embeddingSettings', undefined));
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

function save() {
  return run('save', async () => {
    const previous = saved.value;
    const next = await host().request('saveEmbeddingSettings', form());
    show(next);
    status.value =
      previous && (previous.model !== next.model || previous.dimensions !== next.dimensions)
        ? '已保存。模型或维度变了，已建立的索引要重建后才能使用。'
        : '已保存。';
  });
}

function test() {
  return run('test', async () => {
    const result = await host().request('testEmbedding', form());
    status.value = `连接成功，服务返回 ${result.dimensions} 维向量。`;
  });
}
</script>

<template>
  <SettingsSection
    title="检索"
    title-id="settings-retrieval-title"
    description="让助手按意思查找作品内容，而不只是匹配关键词。填好 embedding 服务后，在助手输入框下方左侧为每部作品建立索引。"
  >
    <AppForm class="agent-form retrieval-settings" :disabled="!!pending || loading || !agent.connected" @submit="save">
      <label
        >服务地址<AppInput v-model="baseUrl" type="url" required autocomplete="off" placeholder="https://…/v1"
      /></label>
      <p class="agent-field-help">OpenAI 兼容接口的地址，请求发往这个地址下的 /embeddings。</p>
      <label
        >API 密钥<AppInput
          v-model="apiKey"
          type="password"
          autocomplete="new-password"
          :placeholder="saved?.hasApiKey ? '已保存，留空保持不变' : '服务不需要密钥时留空'"
      /></label>
      <div class="agent-form-pair">
        <label
          >模型名<AppInput
            v-model="model"
            required
            autocomplete="off"
            placeholder="例如 Qwen/Qwen3-Embedding-8B" /></label
        ><label
          >向量维度<AppNumberInput v-model="dimensions" aria-label="向量维度" :min="1" placeholder="模型默认"
        /></label>
      </div>
      <p class="agent-field-help">向量维度留空时用模型的默认值；只有模型支持调整维度时才需要填。</p>
      <p v-if="error || (!agent.connected && agent.error)" role="alert" class="agent-error">
        {{ error || agent.error }}
      </p>
      <footer class="retrieval-settings-footer">
        <span v-if="status" role="status">{{ status }}</span>
        <AppButton type="button" :disabled="!!pending || loading || !agent.connected" @click="test">{{
          pending === 'test' ? '正在测试…' : '测试连接'
        }}</AppButton>
        <AppButton type="submit" :disabled="!!pending || loading || !agent.connected">{{
          pending === 'save' ? '正在保存…' : '保存'
        }}</AppButton>
      </footer>
    </AppForm>
  </SettingsSection>
</template>

<style lang="scss">
.retrieval-settings {
  max-width: 40rem;
}
.retrieval-settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.retrieval-settings-footer > span {
  margin-right: auto;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
</style>
