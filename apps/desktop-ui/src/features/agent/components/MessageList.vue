<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type {
  Approval,
  ApprovalScope,
  EditorContext,
  QueuedDelivery,
  SessionView
} from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { clearStreamingMarkdownCache, renderMarkdown, renderStreamingMarkdown } from '@/utils/markdown';

import { formatAgentError, formatRetryStatus } from '../error-format';
import type { OutgoingMessage } from '../store';
import { buildTranscript, describeTool, hasRunningTools, summarizeTools, toolRows } from '../transcript';
import EditorContextBadge from './EditorContextBadge.vue';
import MessageActions from './MessageActions.vue';
import ToolCallRow from './ToolCallRow.vue';
import TurnErrorCard from './TurnErrorCard.vue';
import UserMessageItem from './UserMessageItem.vue';

const props = defineProps<{ session: SessionView; approvals: Approval[]; outgoing: OutgoingMessage[] }>();
const emit = defineEmits<{
  approve: [id: string, allow: boolean, scope?: ApprovalScope];
  retry: [key: string];
  discard: [key: string];
  recallQueued: [delivery: QueuedDelivery, index: number];
  editMessage: [payload: { entryId: string; text: string; editorContext?: EditorContext }];
  switchBranch: [leafId: string];
  openModelSettings: [];
}>();

const items = computed(() => buildTranscript(props.session.messages));
const lastIndex = computed(() => props.session.messages.length - 1);
/** 消息已发出但模型还没有输出，或正在自动退避重试时显示等待提示。 */
const waiting = computed(() => {
  if (props.session.retrying) return true;
  if (props.outgoing.some(item => !item.error && !item.delivery)) return true;
  const last = props.session.messages.at(-1);
  return props.session.running && (!last || ['user', 'reviewResults', 'toolResult'].includes(last.role));
});
const waitingText = computed(() =>
  props.session.retrying ? formatRetryStatus(props.session.retrying) : '正在等待回复…'
);
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
    <template v-for="(item, itemIndex) in items" :key="item.key">
      <UserMessageItem
        v-if="item.kind === 'user'"
        :entry-id="item.entryId"
        :text="item.text"
        :compacted="item.compacted"
        :editor-context="item.editorContext"
        :branch="item.branch"
        :readonly="Boolean(session.readonly)"
        :busy="session.running"
        :always-show-actions="itemIndex === items.length - 1 && !session.running && !outgoing.length"
        @edit-message="emit('editMessage', $event)"
        @switch-branch="emit('switchBranch', $event)"
      />
      <details v-else-if="item.kind === 'notice'" class="agent-notice">
        <summary>
          <span class="i-mingcute-check-circle-line size-3.5 shrink-0" aria-hidden="true" />{{ item.text }}
          <span class="agent-notice-chevron i-mingcute-down-line size-3.5 shrink-0" aria-hidden="true" />
        </summary>
        <ul>
          <li v-for="outcome in item.outcomes" :key="outcome.id">{{ outcome.text }}</li>
        </ul>
      </details>
      <section v-else-if="item.kind === 'summary'" class="agent-activity agent-summary" aria-label="压缩总结">
        <button
          type="button"
          class="agent-activity-row"
          :aria-expanded="expanded.has(item.key)"
          @click="toggle(item.key)"
        >
          <span class="i-mingcute-archive-line agent-activity-icon" aria-hidden="true" />
          <span class="agent-activity-summary">之前的对话已压缩为总结</span>
          <span class="i-mingcute-right-line agent-activity-chevron" aria-hidden="true" />
        </button>
        <div
          v-if="expanded.has(item.key)"
          class="agent-activity-detail agent-summary-text markdown-body"
          v-html="renderMarkdown(item.text)"
        />
      </section>
      <article v-else class="agent-assistant" :class="{ 'is-compacted': item.compacted }" aria-label="助手">
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
        <div v-if="item.text" class="agent-assistant-text markdown-body" v-html="html(item.index, item.text)" />
        <section v-if="item.tools.length" class="agent-activity agent-tool-group" aria-label="工具调用">
          <button
            type="button"
            class="agent-activity-row"
            :aria-expanded="expanded.has(`tools:${item.key}`)"
            @click="toggle(`tools:${item.key}`)"
          >
            <span
              v-if="session.running && hasRunningTools(item.tools)"
              class="i-mingcute-loading-line agent-activity-icon animate-spin"
              aria-label="进行中"
            />
            <span v-else class="i-mingcute-tool-line agent-activity-icon" aria-hidden="true" />
            <span class="agent-activity-summary agent-tool-counts">{{ summarizeTools(item.tools) }}</span>
            <span class="i-mingcute-right-line agent-activity-chevron" aria-hidden="true" />
          </button>
          <p v-if="item.tools.some(tool => tool.incomplete)" class="agent-activity-empty">部分调用记录</p>
          <div v-if="expanded.has(`tools:${item.key}`)" class="agent-tool-steps">
            <ToolCallRow
              v-for="tool in toolRows(item.tools).filter(tool => !tool.result?.error)"
              :key="tool.key"
              :tool="tool"
              :running="session.running"
              :session-id="session.sessionId"
              :session-work-id="session.workId"
            />
          </div>
          <ToolCallRow
            v-for="tool in toolRows(item.tools).filter(tool => tool.result?.error)"
            :key="tool.key"
            :tool="tool"
            :running="false"
            :session-id="session.sessionId"
            :session-work-id="session.workId"
          />
        </section>
        <TurnErrorCard
          v-if="item.error && (!session.running || item.index !== lastIndex)"
          :error-message="item.errorMessage"
          :can-retry="!session.readonly && Boolean(item.retryTarget)"
          :disabled="session.running || Boolean(session.readonly)"
          @retry="emit('editMessage', item.retryTarget!)"
          @open-model-settings="emit('openModelSettings')"
        />
        <p v-else-if="item.aborted && (!session.running || item.index !== lastIndex)" class="agent-turn-aborted">
          已停止生成
        </p>
        <MessageActions
          v-if="!session.running || item.index !== lastIndex"
          align="start"
          :copy-text="item.text || undefined"
          :can-retry="!item.error && !session.readonly && Boolean(item.retryTarget)"
          :disabled="session.running || Boolean(session.readonly)"
          :always-visible="Boolean(item.aborted && !item.text && !item.tools.length)"
          @retry="emit('editMessage', item.retryTarget!)"
        />
      </article>
    </template>
    <article
      v-for="(queuedItem, queueIndex) in session.queued"
      :key="`queued:${queuedItem.delivery}:${queueIndex}`"
      class="agent-user is-queued"
      aria-label="作者排队消息"
    >
      <div class="agent-user-body">
        <EditorContextBadge v-if="queuedItem.editorContext" :context="queuedItem.editorContext" />
        <div class="agent-user-text">{{ queuedItem.text }}</div>
        <p class="agent-user-queue-status">
          <span
            :class="queuedItem.delivery === 'followUp' ? 'i-mingcute-time-line' : 'i-mingcute-send-plane-line'"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>{{ queuedItem.delivery === 'followUp' ? '稍后处理排队中' : '插话排队中' }}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            class="agent-queue-recall"
            @click="emit('recallQueued', queuedItem.delivery, queueIndex)"
          >
            撤回重改
          </button>
        </p>
      </div>
    </article>
    <article
      v-for="item in outgoing"
      :key="item.key"
      class="agent-user"
      :class="item.error ? 'is-failed' : 'is-sending'"
      aria-label="作者"
    >
      <div class="agent-user-body">
        <EditorContextBadge v-if="item.editorContext" :context="item.editorContext" />
        <div class="agent-user-text">{{ item.text }}</div>
        <p v-if="!item.error && item.delivery" class="agent-user-queue-status">
          <span
            :class="item.delivery === 'followUp' ? 'i-mingcute-time-line' : 'i-mingcute-send-plane-line'"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>{{ item.delivery === 'followUp' ? '稍后处理排队中' : '插话排队中' }}</span>
        </p>
      </div>
      <p v-if="item.error" class="agent-user-failure" role="alert">
        <span class="i-mingcute-warning-line size-3.5 shrink-0" aria-hidden="true" />
        <span class="flex-1">发送失败：{{ formatAgentError(item.error).summary }}</span>
        <AppButton
          v-if="formatAgentError(item.error).needsModelSettings"
          size="xs"
          variant="ghost"
          @click="emit('openModelSettings')"
          >模型设置</AppButton
        >
        <AppButton size="xs" variant="ghost" @click="emit('discard', item.key)">移除</AppButton>
        <AppButton size="xs" variant="ghost" @click="emit('retry', item.key)">重试</AppButton>
      </p>
    </article>
    <p v-if="waiting" class="agent-waiting" role="status">
      <span class="agent-waiting-dots" aria-hidden="true"><i /><i /><i /></span>{{ waitingText }}
    </p>
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
      <p v-if="approval.remember" class="agent-approval-scope">
        记住后允许读取{{ approval.remember.pathKind === 'file' ? '文件' : '目录' }}：<code>{{
          approval.remember.path
        }}</code>
      </p>
      <details class="agent-approval-detail">
        <summary>查看参数</summary>
        <pre>{{ format(approval.input) }}</pre>
      </details>
      <div class="agent-row agent-approval-actions">
        <AppButton size="sm" variant="primary" @click="emit('approve', approval.id, true, 'once')">仅此次</AppButton>
        <AppButton
          v-if="approval.remember"
          size="sm"
          variant="outline"
          @click="emit('approve', approval.id, true, 'session')"
          >本会话允许</AppButton
        >
        <AppButton
          v-if="approval.remember?.allowWork"
          size="sm"
          variant="outline"
          @click="emit('approve', approval.id, true, 'work')"
          >为这部作品记住</AppButton
        >
        <AppButton size="sm" variant="ghost" @click="emit('approve', approval.id, false)">拒绝</AppButton>
      </div>
    </section>
  </div>
</template>
