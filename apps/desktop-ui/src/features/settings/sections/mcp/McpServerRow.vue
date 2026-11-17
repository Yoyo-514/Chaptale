<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ManagedMcpServerView, McpConfigScope, McpSelectableExposure } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

const props = defineProps<{
  server: ManagedMcpServerView;
  /** 当前查看的配置层级；启停与暴露方式写入这一层。 */
  level: McpConfigScope;
  busy: boolean;
}>();
const emit = defineEmits<{
  toggle: [enabled: boolean];
  expose: [exposure: McpSelectableExposure];
  reconnect: [];
  signIn: [];
  submitRedirect: [redirectUrl: string];
  cancelSignIn: [];
  signOut: [];
}>();

const exposures: { value: McpSelectableExposure; label: string }[] = [
  { value: 'codemode', label: '脚本内调用' },
  { value: 'deferred', label: '按需搜索' },
  { value: 'direct', label: '直接可见' }
];

const redirectUrl = ref('');

const status = computed(() => {
  const { state, tools, error } = props.server;
  switch (state) {
    case 'disabled':
      return { tone: 'idle', text: '已停用' };
    case 'connecting':
      return { tone: 'idle', text: '连接中' };
    case 'connected':
      return { tone: 'ok', text: `已连接，${tools.length} 个工具` };
    case 'needs-auth':
      return { tone: 'warn', text: '需要登录' };
    case 'failed':
      return { tone: 'error', text: error ? `连接失败：${error}` : '连接失败' };
  }
});

const canSignIn = computed(
  () => props.server.usesOAuth && props.server.enabled && !props.server.signingIn && props.server.state !== 'connected'
);

function selectExposure(value: string) {
  // “不提供给助手”只能在 mcp.json 里设置，这里选回它不产生修改。
  if (value !== 'hidden') emit('expose', value as McpSelectableExposure);
}

function submitRedirect() {
  emit('submitRedirect', redirectUrl.value.trim());
  redirectUrl.value = '';
}
</script>

<template>
  <li class="mcp-row" :class="{ 'is-muted': !server.enabled }">
    <AppCheckbox
      class="mcp-row-check"
      :model-value="server.enabled"
      :disabled="busy"
      :aria-label="`启用 MCP 服务 ${server.name}`"
      @update:model-value="emit('toggle', $event === true)"
    />
    <div class="mcp-row-body">
      <div class="mcp-row-main">
        <div class="settings-model-copy mcp-row-copy">
          <div class="mcp-row-title">
            <strong>{{ server.name }}</strong>
            <span v-if="level === 'work'" class="settings-dropdown-item-badge">{{
              server.definedIn === 'work' ? '本作品' : '全局'
            }}</span>
            <span v-if="server.overriddenInWork" class="settings-dropdown-item-badge">已在本作品调整</span>
            <span v-if="server.hasResources" class="settings-dropdown-item-badge">提供资源</span>
          </div>
          <span v-if="server.description">{{ server.description }}</span>
          <code>{{ server.endpoint }}</code>
          <span class="mcp-status" :class="`is-${status.tone}`">{{ status.text }}</span>
        </div>
        <div class="mcp-row-actions">
          <AppSelect
            trigger-class="mcp-exposure"
            :model-value="server.exposure"
            :disabled="busy"
            :aria-label="`${server.name} 的暴露方式`"
            @update:model-value="selectExposure($event as string)"
          >
            <AppSelectItem v-if="server.exposure === 'hidden'" value="hidden">不提供给助手</AppSelectItem>
            <AppSelectItem v-for="item in exposures" :key="item.value" :value="item.value">{{
              item.label
            }}</AppSelectItem>
          </AppSelect>
          <AppButton
            v-if="canSignIn"
            type="button"
            size="sm"
            variant="outline"
            :disabled="busy"
            @click="emit('signIn')"
          >
            登录
          </AppButton>
          <AppButton
            v-if="server.hasStoredAuth"
            type="button"
            size="sm"
            variant="ghost"
            :disabled="busy"
            @click="emit('signOut')"
          >
            登出
          </AppButton>
          <AppButton
            v-if="server.enabled"
            type="button"
            size="sm"
            variant="ghost"
            :disabled="busy"
            @click="emit('reconnect')"
          >
            重连
          </AppButton>
        </div>
      </div>

      <div v-if="server.signingIn" class="mcp-sign-in">
        <p class="mcp-sign-in-hint">
          登录页已在浏览器打开。登录后页面没有跳回 Chaptale 时，把浏览器地址栏里的完整地址粘贴到这里。
        </p>
        <div class="mcp-sign-in-controls">
          <AppInput
            v-model="redirectUrl"
            class="mcp-sign-in-input"
            type="url"
            placeholder="http://127.0.0.1:…"
            :aria-label="`${server.name} 登录后的跳转地址`"
          />
          <AppButton
            type="button"
            size="sm"
            variant="outline"
            :disabled="busy || !redirectUrl.trim()"
            @click="submitRedirect"
          >
            提交地址
          </AppButton>
          <AppButton type="button" size="sm" variant="ghost" @click="emit('cancelSignIn')">取消登录</AppButton>
        </div>
      </div>

      <details v-if="server.tools.length" class="mcp-tools">
        <summary>查看 {{ server.tools.length }} 个工具</summary>
        <ul class="mcp-tool-list">
          <li v-for="tool in server.tools" :key="tool.name" class="mcp-tool">
            <code>{{ tool.name }}</code>
            <span v-if="tool.description">{{ tool.description }}</span>
          </li>
        </ul>
      </details>
    </div>
  </li>
</template>

<style scoped lang="scss">
.mcp-row {
  @apply flex items-start gap-3 px-3.5 py-2.5;
  border-color: var(--border-subtle);
}

.mcp-row.is-muted .mcp-row-copy {
  opacity: 0.65;
}

.mcp-row-check {
  @apply mt-0.5 shrink-0;
}

.mcp-row-body {
  @apply flex min-w-0 flex-1 flex-col gap-2;
}

.mcp-row-main {
  @apply flex flex-wrap items-start justify-between gap-x-3 gap-y-2;
}

.mcp-row-copy {
  @apply flex-1;
  min-width: 14rem;
}

.mcp-row-title {
  @apply flex flex-wrap items-center gap-2;
}

.mcp-row-actions {
  @apply flex shrink-0 flex-wrap items-center gap-1;
}

:deep(.mcp-exposure) {
  min-width: 7.5rem;
}

.mcp-status {
  @apply flex items-center gap-1.5;
  overflow-wrap: anywhere;
}

.mcp-status::before {
  @apply size-1.5 shrink-0 rounded-full;
  background: var(--muted-foreground);
  content: '';
}

.mcp-status.is-ok::before {
  background: var(--success);
}

.mcp-status.is-warn::before {
  background: var(--warning);
}

.mcp-status.is-error {
  color: var(--destructive);
}

.mcp-status.is-error::before {
  background: var(--destructive);
}

.mcp-sign-in {
  @apply flex flex-col gap-2 border p-2.5;
  background: var(--surface);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.mcp-sign-in-hint {
  @apply m-0 text-xs leading-5;
  color: var(--muted-foreground);
}

.mcp-sign-in-controls {
  @apply flex flex-wrap items-center gap-1.5;
}

.mcp-sign-in-input {
  @apply min-w-0 flex-1;
  min-width: 12rem;
}

.mcp-tools {
  @apply text-xs;
  color: var(--muted-foreground);
}

.mcp-tools summary {
  @apply w-fit cursor-pointer;
}

.mcp-tool-list {
  @apply m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0;
}

.mcp-tool {
  @apply flex flex-col gap-0.5;
}

.mcp-tool code {
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.mcp-tool span {
  white-space: pre-line;
}
</style>
