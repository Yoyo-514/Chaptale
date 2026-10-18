<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { Approval, SessionView } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { clearStreamingMarkdownCache, renderMarkdown, renderStreamingMarkdown } from '@/utils/markdown';

import { buildTranscript, describeTool } from '../transcript';

const props = defineProps<{ session: SessionView; approvals: Approval[] }>();
const emit = defineEmits<{ approve: [id: string, allow: boolean] }>();

const items = computed(() => buildTranscript(props.session.messages));
const lastIndex = computed(() => props.session.messages.length - 1);
const expanded = ref(new Set<string>());
const streamKey = (index: number) => `${props.session.id}:${index}`;

function toggle(key: string) {
  const next = new Set(expanded.value);
  if (!next.delete(key)) next.add(key);
  expanded.value = next;
}
function html(index: number, text: string) {
  return props.session.running && index === lastIndex.value
    ? renderStreamingMarkdown(streamKey(index), text)
    : renderMarkdown(text);
}
function format(input: unknown) {
  return JSON.stringify(input, null, 2);
}
// 生成结束后最后一条改走完整渲染，流式缓存随之作废。
watch(
  () => props.session.running,
  (running, was) => {
    if (was && !running) clearStreamingMarkdownCache(streamKey(lastIndex.value));
  }
);
onBeforeUnmount(() => clearStreamingMarkdownCache(streamKey(lastIndex.value)));
</script>

<template>
  <div class="agent-transcript">
    <template v-for="item in items" :key="item.key">
      <article v-if="item.kind === 'user'" class="agent-user" aria-label="作者">
        <div class="agent-user-text">{{ item.text }}</div>
      </article>
      <article v-else class="agent-assistant" aria-label="助手">
        <div v-if="item.thinking" class="agent-activity">
          <button
            type="button"
            class="agent-activity-row"
            :aria-expanded="expanded.has(item.thinking.key)"
            @click="toggle(item.thinking.key)"
          >
            <span class="i-mingcute-bulb-line agent-activity-icon" aria-hidden="true" />
            <span class="agent-activity-summary">{{
              session.running && item.index === lastIndex && !item.text ? '正在思考…' : '思考过程'
            }}</span>
            <span class="i-mingcute-right-line agent-activity-chevron" aria-hidden="true" />
          </button>
          <div v-if="expanded.has(item.thinking.key)" class="agent-activity-detail agent-thinking">
            {{ item.thinking.text }}
          </div>
        </div>
        <div
          v-if="item.text"
          class="agent-assistant-text markdown-body"
          :class="{ 'agent-error': item.error }"
          v-html="html(item.index, item.text)"
        />
        <div v-for="tool in item.tools" :key="tool.key" class="agent-activity">
          <button
            type="button"
            class="agent-activity-row"
            :aria-expanded="expanded.has(tool.key)"
            @click="toggle(tool.key)"
          >
            <span
              v-if="!tool.result && session.running"
              class="i-mingcute-loading-line agent-activity-icon animate-spin"
              aria-label="进行中"
            />
            <span
              v-else-if="tool.result?.error"
              class="i-mingcute-warning-line agent-activity-icon is-error"
              aria-label="失败"
            />
            <span v-else class="i-mingcute-file-search-line agent-activity-icon" aria-hidden="true" />
            <span class="agent-activity-summary" :title="tool.summary">{{ tool.summary }}</span>
            <span class="i-mingcute-right-line agent-activity-chevron" aria-hidden="true" />
          </button>
          <div v-if="expanded.has(tool.key)" class="agent-activity-detail">
            <pre v-if="tool.input !== undefined">{{ format(tool.input) }}</pre>
            <pre v-if="tool.result" :class="{ 'agent-error': tool.result.error }">{{ tool.result.text }}</pre>
            <p v-else class="agent-activity-empty">还没有结果。</p>
          </div>
        </div>
      </article>
    </template>
    <section
      v-for="approval in approvals"
      :key="approval.id"
      class="agent-approval"
      :aria-label="`${approval.toolName} 授权`"
    >
      <p class="agent-approval-title">
        <span class="i-mingcute-shield-line size-4 shrink-0" aria-hidden="true" />
        <span>助手想要{{ describeTool(approval.toolName, approval.input, false) }}</span>
      </p>
      <details class="agent-approval-detail">
        <summary>查看参数</summary>
        <pre>{{ format(approval.input) }}</pre>
      </details>
      <div class="agent-row">
        <AppButton size="sm" variant="primary" @click="emit('approve', approval.id, true)">允许这次调用</AppButton>
        <AppButton size="sm" variant="ghost" @click="emit('approve', approval.id, false)">拒绝</AppButton>
      </div>
    </section>
  </div>
</template>
