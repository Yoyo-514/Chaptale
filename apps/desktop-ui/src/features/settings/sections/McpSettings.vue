<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import type {
  ManagedMcpServerView,
  ManagedMcpSnapshot,
  McpConfigScope,
  McpSelectableExposure
} from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppNotice } from '@/components/AppNotice';
import { AppTabs } from '@/components/AppTabs';
import { AppTextarea } from '@/components/AppTextarea';
import { useCreationStore } from '@/features/creation';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import SettingsSection from '../components/SettingsSection.vue';
import McpServerRow from './mcp/McpServerRow.vue';

const creation = useCreationStore();
/** 当前查看的配置层级：全局页只看全局服务，作品页看全局与本作品合并后的结果。 */
const level = ref<McpConfigScope>('global');
const snapshot = ref<ManagedMcpSnapshot | null>(null);
/** 各层级尚未保存的 mcp.json 文本；undefined 表示与已保存内容一致。 */
const drafts = reactive<Record<McpConfigScope, string | undefined>>({ global: undefined, work: undefined });
const busy = ref(false);
const error = ref('');

const activeWork = computed(() =>
  creation.workId ? creation.works.find(item => item.id === creation.workId) : undefined
);
const levels = computed(() => [
  { value: 'global', label: '全局' },
  ...(creation.workId
    ? [{ value: 'work', label: activeWork.value ? `当前作品《${activeWork.value.title}》` : '当前作品' }]
    : [])
]);
const workId = computed(() => (level.value === 'work' ? creation.workId : null));
const file = computed(() => (level.value === 'work' ? snapshot.value?.workFile : snapshot.value?.globalFile));
const savedJson = computed(
  () => (level.value === 'work' ? snapshot.value?.workJson : snapshot.value?.globalJson) ?? ''
);
const fileErrors = computed(
  () => (level.value === 'work' ? snapshot.value?.workErrors : snapshot.value?.globalErrors) ?? []
);
const draft = computed({
  get: () => drafts[level.value] ?? savedJson.value,
  set: value => {
    drafts[level.value] = value === savedJson.value ? undefined : value;
  }
});
const dirty = computed(() => drafts[level.value] !== undefined);

// 连接状态由宿主随时推送，较早发出的请求不能盖掉较新的快照。
let latest = 0;
async function load(request: () => Promise<ManagedMcpSnapshot>) {
  const seq = ++latest;
  const next = await request();
  if (seq === latest) snapshot.value = next;
}

async function act(request: () => Promise<ManagedMcpSnapshot>) {
  busy.value = true;
  error.value = '';
  try {
    await load(request);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function refresh() {
  const id = workId.value;
  return act(() => getDesktopApi().agentHost.request('getMcpState', { workId: id }));
}

let offEvents: (() => void) | undefined;
onMounted(() => {
  offEvents = getDesktopApi().agentHost.subscribe(event => {
    if (event.kind !== 'mcp') return;
    const id = workId.value;
    load(() => getDesktopApi().agentHost.request('getMcpState', { workId: id })).catch(cause => {
      error.value = toErrorMessage(cause);
    });
  });
  void refresh();
});
onBeforeUnmount(() => offEvents?.());

watch(
  () => creation.workId,
  id => {
    drafts.work = undefined;
    if (!id) level.value = 'global';
  }
);
watch(workId, () => {
  snapshot.value = null;
  void refresh();
});

function save() {
  const scope = level.value;
  const id = workId.value;
  const json = draft.value;
  void act(async () => {
    const next = await getDesktopApi().agentHost.request('saveMcpConfig', { scope, workId: id, json });
    // 回执只确认送出的文本；保存期间继续输入的内容保留为新的未保存修改。
    if (drafts[scope] === json) drafts[scope] = undefined;
    return next;
  });
}

function patch(server: ManagedMcpServerView, change: { enabled?: boolean; exposure?: McpSelectableExposure }) {
  const targetScope = level.value;
  const id = workId.value;
  void act(() =>
    getDesktopApi().agentHost.request('patchMcpServer', { targetScope, workId: id, name: server.name, ...change })
  );
}

function run(method: 'reconnectMcpServer' | 'cancelMcpSignIn' | 'signOutMcpServer', server: ManagedMcpServerView) {
  const id = workId.value;
  void act(() => getDesktopApi().agentHost.request(method, { workId: id, name: server.name }));
}

function signIn(server: ManagedMcpServerView) {
  const id = workId.value;
  void act(
    async () => (await getDesktopApi().agentHost.request('startMcpSignIn', { workId: id, name: server.name })).snapshot
  );
}

function submitRedirect(server: ManagedMcpServerView, redirectUrl: string) {
  const id = workId.value;
  void act(() =>
    getDesktopApi().agentHost.request('submitMcpRedirectUrl', { workId: id, name: server.name, redirectUrl })
  );
}
</script>

<template>
  <SettingsSection
    title="MCP 服务"
    title-id="settings-mcp-title"
    description="连接外部工具服务。全局配置对所有作品和独立对话生效，作品配置只在这部作品里生效，同名时以作品为准。助手每次调用都要先经你同意。"
  >
    <template #actions>
      <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="refresh">
        <span class="i-mingcute-refresh-2-line size-4" aria-hidden="true" />
        <span>刷新</span>
      </AppButton>
    </template>

    <AppTabs
      :model-value="level"
      :items="levels"
      label="MCP 配置层级"
      @update:model-value="level = $event as McpConfigScope"
    >
      <div class="mcp-settings">
        <AppNotice v-if="error" tone="error"><span class="mcp-error-text">{{ error }}</span></AppNotice>

        <section class="mcp-group" aria-label="MCP 配置文件">
          <header class="mcp-group-heading">
            <h4 class="mcp-group-title">配置文件</h4>
            <p class="mcp-group-hint">
              每个服务写在 <code>mcpServers</code> 下：本机程序填 <code>command</code> 和 <code>args</code>，远程服务填
              <code>url</code>。<template v-if="file">文件位置：<code>{{ file }}</code></template>
            </p>
          </header>
          <AppNotice v-if="fileErrors.length" tone="warning">
            <ul class="mcp-file-errors">
              <li v-for="(item, index) in fileErrors" :key="index">{{ item }}</li>
            </ul>
          </AppNotice>
          <AppTextarea
            v-model="draft"
            class="mcp-json"
            :rows="12"
            :disabled="!snapshot"
            spellcheck="false"
            aria-label="mcp.json 内容"
          />
          <div class="mcp-json-actions">
            <AppButton
              v-if="dirty"
              type="button"
              size="sm"
              variant="ghost"
              :disabled="busy"
              @click="drafts[level] = undefined"
            >
              放弃修改
            </AppButton>
            <AppButton type="button" size="sm" variant="primary" :disabled="busy || !dirty" @click="save">
              保存并连接
            </AppButton>
          </div>
        </section>

        <section class="mcp-group" aria-label="MCP 服务列表">
          <header class="mcp-group-heading">
            <h4 class="mcp-group-title">服务</h4>
            <p class="mcp-group-hint">
              暴露方式决定助手怎么用这些工具：脚本内调用不占工具列表，按需搜索要先查找再调用，直接可见会一直列在助手面前。<template
                v-if="level === 'work'"
                >在这里启停或调整全局服务，只影响这部作品。</template
              >
            </p>
          </header>
          <ul v-if="snapshot?.servers.length" class="mcp-list">
            <McpServerRow
              v-for="server in snapshot.servers"
              :key="`${server.definedIn}:${server.name}`"
              :server="server"
              :level="level"
              :busy="busy"
              @toggle="patch(server, { enabled: $event })"
              @expose="patch(server, { exposure: $event })"
              @reconnect="run('reconnectMcpServer', server)"
              @sign-in="signIn(server)"
              @submit-redirect="submitRedirect(server, $event)"
              @cancel-sign-in="run('cancelMcpSignIn', server)"
              @sign-out="run('signOutMcpServer', server)"
            />
          </ul>
          <div v-else-if="snapshot" class="settings-empty-card">还没有服务。在上面的配置文件里添加后保存。</div>
        </section>
      </div>
    </AppTabs>
  </SettingsSection>
</template>

<style scoped lang="scss">
.mcp-settings {
  @apply flex flex-col gap-6 pt-4;
}

.mcp-error-text {
  white-space: pre-line;
}

.mcp-group {
  @apply flex flex-col gap-2.5;
}

.mcp-group-heading {
  @apply flex min-w-0 flex-col gap-0.5;
}

.mcp-group-title {
  @apply m-0 font-semibold;
  font-size: var(--ui-font-size);
}

.mcp-group-hint {
  @apply m-0 text-xs leading-5;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}

.mcp-group-hint code {
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
}

.mcp-file-errors {
  @apply m-0 flex list-none flex-col gap-1 p-0;
}

.mcp-json {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  tab-size: 2;
}

.mcp-json-actions {
  @apply flex items-center justify-end gap-2;
}

.mcp-list {
  @apply m-0 flex list-none flex-col divide-y border p-0;
  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}
</style>
