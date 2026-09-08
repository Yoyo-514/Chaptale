<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTextView } from '@/components/AppTextView';
import { AppUsageDetails } from '@/components/AppUsageDetails';
import { useEditorStore } from '@/features/editor';

import { RUN_PERSONA_LABELS, RUN_STATUS_LABELS, runReference, runTitle } from '../presentation';
import { useRunStore } from '../store';

const runs = useRunStore();
const editor = useEditorStore();
const record = computed(() => runs.selected);
const references = computed(() => record.value?.memoryRefs.map(runReference) ?? []);
async function openSource(sourcePath: string) {
  runs.close();
  await editor.openDocument(sourcePath);
}
</script>
<template>
  <AppDialog :open="Boolean(record)" title="运行详情" content-size="lg" @update:open="open => !open && runs.close()">
    <AppScrollArea v-if="record" class="run-details-scroll">
      <div class="run-details">
        <h3>{{ runTitle(record) }}</h3>
        <dl class="run-metadata">
          <dt>角色</dt>
          <dd>{{ RUN_PERSONA_LABELS[record.personaId] ?? record.personaId }} · {{ record.personaId }}</dd>
          <dt>状态</dt>
          <dd>{{ RUN_STATUS_LABELS[record.status] }}</dd>
          <dt>模型</dt>
          <dd>{{ record.model ? `${record.model.provider} / ${record.model.modelId}` : '未记录' }}</dd>
          <dt>输入 / 输出</dt>
          <dd>{{ record.usage.inputTokens }} / {{ record.usage.outputTokens }} tokens</dd>
          <dt>缓存策略</dt>
          <dd>
            {{
              record.cachePolicy
                ? {
                    'provider-default': '由服务商决定',
                    'openai-automatic': 'OpenAI 自动前缀缓存',
                    'openai-explicit': 'OpenAI 稳定前缀断点',
                    anthropic: 'Anthropic 稳定前缀断点'
                  }[record.cachePolicy]
                : '未记录'
            }}
          </dd>
          <dt>开始</dt>
          <dd>{{ new Date(record.createdAt).toLocaleString() }}</dd>
          <dt>结束</dt>
          <dd>{{ record.completedAt ? new Date(record.completedAt).toLocaleString() : '未记录' }}</dd>
          <dt>发起方式</dt>
          <dd>{{ { user: '作者发起', delegate: '委派', 'ui-action': '界面操作' }[record.trigger] }}</dd>
          <dt>运行 ID</dt>
          <dd>
            <code>{{ record.id }}</code>
          </dd>
          <dt>模板指纹</dt>
          <dd>
            <code>{{ record.promptTemplateHash || '未记录' }}</code>
          </dd>
          <dt v-if="record.parentSessionId">所属对话</dt>
          <dd v-if="record.parentSessionId">
            <code>{{ record.parentSessionId }}</code>
          </dd>
        </dl>
        <section aria-label="运行用量明细">
          <h3>用量明细</h3>
          <AppUsageDetails :usage="record.usage" />
        </section>
        <section v-if="record.inputDigest.files?.length">
          <h3>目标文件</h3>
          <p v-for="file in record.inputDigest.files" :key="file">{{ file }}</p>
        </section>
        <section aria-label="运行读取来源">
          <h3>读取来源</h3>
          <p v-if="!references.length" class="run-muted">未登记读取来源</p>
          <ul v-else class="run-sources">
            <li v-for="(source, index) in references" :key="index">
              <AppButton v-if="source.canOpen" variant="link" @click="openSource(source.sourcePath)">{{
                source.sourcePath
              }}</AppButton>
              <span v-else>{{ source.sourcePath }}</span>
              <code>{{ source.hash ?? '未记录内容指纹' }}</code>
            </li>
          </ul>
        </section>
        <section v-if="record.inputDigest.packId" aria-label="运行参考快照">
          <h3>
            本次写作参考 · <code>{{ record.inputDigest.packId }}</code>
          </h3>
          <p v-if="runs.packError" role="alert">{{ runs.packError }}</p>
          <template v-if="runs.pack">
            <p>{{ runs.pack.goal }}</p>
            <details v-for="section in runs.pack.sections" :key="section.sourcePath" class="run-reference">
              <summary>{{ section.title }} · {{ section.chars }} 字符</summary>
              <p>{{ section.sourcePath }} · {{ section.updatedAt }}</p>
              <code>{{ section.sourceHash }}</code>
              <AppTextView :text="section.content" :label="`参考快照全文 ${section.title}`" />
            </details>
          </template>
        </section>
        <section aria-label="运行原始输出">
          <h3>原始输出</h3>
          <p v-if="record.outputRef">{{ record.outputRef }}</p>
          <p v-if="!record.outputRef" class="run-muted">此运行没有留档输出</p>
          <p v-else-if="!record.outputHash" class="run-warning">旧记录未绑定输出指纹</p>
          <p v-if="record.outputHash">
            <code>{{ record.outputHash }}</code>
          </p>
          <p v-if="runs.reading" role="status">正在读取留档</p>
          <p v-else-if="runs.outputError" role="alert">{{ runs.outputError }}</p>
          <AppTextView v-else-if="runs.outputText" :text="runs.outputText" label="原始输出全文" />
        </section>
      </div>
    </AppScrollArea>
  </AppDialog>
</template>
<style scoped lang="scss">
.run-details-scroll {
  @apply min-h-0 flex-1;
  max-height: calc(100vh - 10rem);
}
.run-details {
  @apply flex min-w-0 flex-col gap-4 pt-3;
  font-size: var(--ui-font-size);
}
h3,
p,
dd {
  @apply m-0;
  overflow-wrap: anywhere;
}
h3 {
  @apply font-medium;
  font-size: var(--ui-font-size);
}
.run-metadata {
  @apply m-0 grid gap-x-3 gap-y-2;
  grid-template-columns: 6.5rem minmax(0, 1fr);
}
dt,
.run-muted {
  color: var(--muted-foreground);
}
section {
  @apply flex min-w-0 flex-col gap-2 border-t pt-3;
  border-color: var(--border-subtle);
}
code {
  @apply font-mono;
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.run-sources {
  @apply m-0 flex list-none flex-col gap-3 p-0;
}
.run-sources li {
  @apply flex min-w-0 flex-col items-start gap-1;
  overflow-wrap: anywhere;
}
.run-sources :deep(.app-button) {
  @apply max-w-full whitespace-normal text-left;
  overflow-wrap: anywhere;
}
.run-sources code {
  color: var(--muted-foreground);
}
.run-reference {
  @apply min-w-0 border-b py-2;
  border-color: var(--border-subtle);
}
summary {
  @apply cursor-pointer;
  overflow-wrap: anywhere;
}
.run-warning {
  color: var(--warning);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
