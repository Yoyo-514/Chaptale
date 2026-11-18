<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ManagedMcpServerView, McpConfigScope, McpSelectableExposure } from '@chaptale/agent-host/protocol';

import { AppBadge } from '@/components/AppBadge';
import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppSwitch } from '@/components/AppSwitch';
import { AppTooltip } from '@/components/AppTooltip';
import { SettingsListRow } from '@/features/settings';

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
  <SettingsListRow :title="server.name" :muted="!server.enabled">
    <template #badges>
      <AppBadge v-if="level === 'work'">{{ server.definedIn === 'work' ? '本作品' : '全局' }}</AppBadge>
      <AppBadge v-if="server.overriddenInWork">已在本作品调整</AppBadge>
      <AppBadge v-if="server.hasResources">提供资源</AppBadge>
    </template>
    <span v-if="server.description">{{ server.description }}</span>
    <code>{{ server.endpoint }}</code>
    <span class="mcp-status" :class="`is-${status.tone}`">{{ status.text }}</span>
    <template #actions>
      <AppTooltip v-if="server.hasStoredAuth" text="登出">
        <AppButton
          type="button"
          icon
          size="sm"
          variant="ghost"
          :disabled="busy"
          :aria-label="`登出 MCP 服务 ${server.name}`"
          @click="emit('signOut')"
        >
          <span class="i-mingcute-exit-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
      <AppTooltip v-if="server.enabled" text="重连">
        <AppButton
          type="button"
          icon
          size="sm"
          variant="ghost"
          :disabled="busy"
          :aria-label="`重连 MCP 服务 ${server.name}`"
          @click="emit('reconnect')"
        >
          <span class="i-mingcute-refresh-2-line size-4" aria-hidden="true" />
        </AppButton>
      </AppTooltip>
    </template>
    <template #trailing>
      <AppButton v-if="canSignIn" type="button" size="sm" variant="outline" :disabled="busy" @click="emit('signIn')">
        登录
      </AppButton>
      <AppSelect
        trigger-class="mcp-exposure"
        :model-value="server.exposure"
        :disabled="busy"
        :aria-label="`${server.name} 的暴露方式`"
        @update:model-value="selectExposure($event as string)"
      >
        <AppSelectItem v-if="server.exposure === 'hidden'" value="hidden">不提供给助手</AppSelectItem>
        <AppSelectItem v-for="item in exposures" :key="item.value" :value="item.value">{{ item.label }}</AppSelectItem>
      </AppSelect>
      <AppSwitch
        class="mcp-switch"
        :model-value="server.enabled"
        :disabled="busy"
        :aria-label="`启用 MCP 服务 ${server.name}`"
        @update:model-value="emit('toggle', $event)"
      />
    </template>
    <template #extra>
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
    </template>
  </SettingsListRow>
</template>

<style scoped lang="scss">
.mcp-switch {
  @apply ml-2;
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
