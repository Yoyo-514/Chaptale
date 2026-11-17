<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type {
  Approval,
  ApprovalScope,
  EditorContext,
  McpApprovalRememberTarget,
  QueuedDelivery,
  SessionView
} from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { clearStreamingMarkdownCache, renderMarkdown, renderStreamingMarkdown } from '@/utils/markdown';

import { formatAgentError, formatRetryStatus } from '../error-format';
import { splitOutgoingSkillPrompt } from '../skills';
import type { OutgoingMessage } from '../store';
import { buildTranscript, describeTool, hasRunningTools, summarizeTools, toolRows } from '../transcript';
import EditorContextBadge from './EditorContextBadge.vue';
import MessageActions from './MessageActions.vue';
import SkillBadge from './SkillBadge.vue';
import ToolCallRow from './ToolCallRow.vue';
import TurnErrorCard from './TurnErrorCard.vue';
import UserMessageItem from './UserMessageItem.vue';

const props = defineProps<{ session: SessionView; approvals: Approval[]; outgoing: OutgoingMessage[] }>();
const emit = defineEmits<{
  approve: [id: string, allow: boolean, scope?: ApprovalScope, mcpTarget?: McpApprovalRememberTarget];
  retry: [key: string];
  discard: [key: string];
  recallQueued: [delivery: QueuedDelivery, index: number];
  editMessage: [payload: { entryId: string; text: string; editorContext?: EditorContext }];
  switchBranch: [leafId: string];
  openModelSettings: [];
}>();

/** 作者在 MCP 授权卡片上勾选了“整台服务”的请求；未勾选时只记住这次调用的工具。 */
const serverWide = ref<Record<string, boolean>>({});
function remember(approval: Approval, scope: 'session' | 'work') {
  if (approval.remember?.capability === 'mcp')
    emit('approve', approval.id, true, scope, serverWide.value[approval.id] ? 'server' : 'tool');
  else emit('approve', approval.id, true, scope);
}

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
        :skill="item.skill"
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
        <SkillBadge v-if="queuedItem.skill" :name="queuedItem.skill.name" />
        <div v-if="queuedItem.text || !queuedItem.skill" class="agent-user-text">{{ queuedItem.text }}</div>
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
        <SkillBadge
          v-if="splitOutgoingSkillPrompt(item.text).skill"
          :name="splitOutgoingSkillPrompt(item.text).skill!.name"
        />
        <div
          v-if="splitOutgoingSkillPrompt(item.text).text || !splitOutgoingSkillPrompt(item.text).skill"
          class="agent-user-text"
        >
          {{ splitOutgoingSkillPrompt(item.text).text }}
        </div>
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
        <span v-if="approval.remember?.capability === 'mcp'"
          >助手想要调用 MCP 服务 {{ approval.remember.serverName }} 的 {{ approval.remember.toolLabel }}</span
        >
        <span v-else>助手想要{{ describeTool(approval.toolName, approval.input, false) }}</span>
      </p>
      <p v-if="approval.remember?.capability === 'fs_read'" class="agent-approval-scope">
        记住后允许读取{{ approval.remember.pathKind === 'file' ? '文件' : '目录' }}：<code>{{
          approval.remember.path
        }}</code>
      </p>
      <template v-else-if="approval.remember">
        <p class="agent-approval-scope">
          <template v-if="serverWide[approval.id]">记住后允许调用该服务的全部工具</template>
          <template v-else> 记住后允许调用 <code>{{ approval.remember.toolLabel }}</code></template>
        </p>
        <label class="agent-approval-option">
          <AppCheckbox
            :model-value="serverWide[approval.id] === true"
            @update:model-value="serverWide[approval.id] = $event === true"
          />
          <span>记住时放行该服务的全部调用</span>
        </label>
      </template>
      <details class="agent-approval-detail">
        <summary>查看参数</summary>
        <pre>{{ format(approval.input) }}</pre>
      </details>
      <div class="agent-row agent-approval-actions">
        <AppButton size="sm" variant="primary" @click="emit('approve', approval.id, true, 'once')">仅此次</AppButton>
        <AppButton v-if="approval.remember" size="sm" variant="outline" @click="remember(approval, 'session')"
          >本会话允许</AppButton
        >
        <AppButton v-if="approval.remember?.allowWork" size="sm" variant="outline" @click="remember(approval, 'work')"
          >为这部作品记住</AppButton
        >
        <AppButton size="sm" variant="ghost" @click="emit('approve', approval.id, false)">拒绝</AppButton>
      </div>
    </section>
  </div>
</template>

<style lang="scss">
/* 对话：作者浅色气泡靠右，助手正文铺满；活动行是一行小字，点开看细节。 */
.agent-transcript {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 8px;
}
.agent-assistant {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
.agent-assistant-text {
  margin-block: 4px 8px;
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.agent-activity {
  min-width: 0;
}
.agent-tool-counts {
  font-variant-numeric: tabular-nums;
}
.agent-tool-steps {
  padding-left: 14px;
}
.agent-assistant.is-compacted {
  opacity: 0.6;
}
.agent-user-queue-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-queue-recall {
  padding: 0 2px;
  border: none;
  background: none;
  color: var(--foreground);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.agent-queue-recall:hover {
  color: var(--primary);
}
.agent-queue-recall:focus-visible {
  outline: none;
  border-radius: var(--radius-control-sm);
  box-shadow: var(--input-focus-shadow);
}
.agent-user-failure {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 85%;
  margin: 0;
  color: var(--destructive);
  font-size: var(--ui-caption-size);
}
.agent-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-waiting-dots {
  display: inline-flex;
  gap: 3px;
  i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: agent-waiting 1.2s ease-in-out infinite;
  }
  i:nth-child(2) {
    animation-delay: 0.15s;
  }
  i:nth-child(3) {
    animation-delay: 0.3s;
  }
}
@keyframes agent-waiting {
  0%,
  80%,
  100% {
    opacity: 0.25;
  }
  40% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-waiting-dots i {
    animation: none;
    opacity: 0.6;
  }
}
.agent-notice {
  margin: 8px 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  summary {
    display: flex;
    gap: 6px;
    align-items: center;
    width: fit-content;
    cursor: pointer;
    list-style: none;
    border-radius: var(--radius-control-sm);
    &::-webkit-details-marker {
      display: none;
    }
    &:hover {
      color: var(--foreground);
    }
    &:focus-visible {
      outline: 2px solid var(--ring);
      outline-offset: 2px;
    }
  }
  &[open] .agent-notice-chevron {
    transform: rotate(180deg);
  }
  ul {
    margin: 4px 0 0 20px;
    padding: 0;
    list-style: none;
  }
  li {
    padding: 1px 0;
  }
}
.agent-summary {
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-subtle);
}
.agent-summary-text {
  max-height: 24rem;
  overflow: auto;
}
.agent-summary-text.markdown-body :is(h1, h2, h3, h4) {
  margin: 8px 0 4px;
  font-size: var(--ui-caption-size);
  font-weight: 600;
}
.agent-thinking {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-approval {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-block: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-overlay);
  background: var(--surface-elevated);
}
.agent-approval-title {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  font-size: var(--ui-font-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.agent-approval-title > span:first-child {
  margin-top: 2px;
  color: var(--primary-solid);
}
.agent-approval-scope {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.agent-approval-scope code {
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}
.agent-approval-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  color: var(--foreground);
  font-size: var(--ui-caption-size);
  cursor: pointer;
}
.agent-approval-actions {
  flex-wrap: wrap;
}
.agent-approval-detail {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.agent-approval-detail summary {
  cursor: pointer;
}
.agent-approval-detail pre {
  max-height: 12rem;
  overflow: auto;
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-turn-aborted {
  margin: 4px 0 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.5;
}
</style>
