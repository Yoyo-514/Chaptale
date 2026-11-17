<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { ToolPermission } from '@chaptale/agent-host/protocol';
import type { TrashedWork } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppNotice } from '@/components/AppNotice';
import { requestCreation, useCreationStore } from '@/features/creation';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useAgentStore } from '../store';

interface WorkPermissionGroup {
  workId: string;
  title: string;
  trashed: boolean;
  items: ToolPermission[];
}

const agent = useAgentStore();
const creation = useCreationStore();
const trashedWorks = ref<TrashedWork[]>([]);
const revokingId = ref<string | null>(null);
const error = ref('');

onMounted(async () => {
  void agent.connect();
  try {
    trashedWorks.value = await requestCreation('listTrashedWorks', {});
  } catch {
    // 作品服务尚未就绪时保留正常列表标题或默认占位。
  }
});

const groups = computed<WorkPermissionGroup[]>(() => {
  const list = agent.state?.settings.toolPermissions ?? [];
  const byWork = new Map<string, ToolPermission[]>();
  for (const item of list) {
    if (item.scope.kind !== 'work') continue;
    const bucket = byWork.get(item.scope.workId);
    if (bucket) bucket.push(item);
    else byWork.set(item.scope.workId, [item]);
  }
  const result: WorkPermissionGroup[] = [];
  for (const [workId, items] of byWork) {
    const active = creation.works.find(work => work.id === workId);
    const trashed = active ? undefined : trashedWorks.value.find(work => work.id === workId);
    result.push({
      workId,
      title: active?.title ?? trashed?.title ?? '已移除的作品',
      trashed: Boolean(trashed),
      items
    });
  }
  return result;
});

async function revoke(id: string) {
  revokingId.value = id;
  error.value = '';
  try {
    await getDesktopApi().agentHost.request('revokeToolPermission', { id });
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    revokingId.value = null;
  }
}
</script>

<template>
  <SettingsSection
    title="工具授权"
    title-id="settings-permissions-title"
    description="管理为作品记住的目录外读取与 MCP 调用权限。撤销后，助手再次访问时会重新询问。本机授权不会随作品包导出。"
  >
    <div class="permission-settings">
      <AppNotice v-if="error" tone="error">{{ error }}</AppNotice>
      <div v-if="!groups.length" class="settings-empty-card">
        还没有为任何作品记住授权。在对话授权卡片中选择“为这部作品记住”后会显示在这里。
      </div>
      <div v-else class="permission-work-groups">
        <section
          v-for="group in groups"
          :key="group.workId"
          class="permission-work-group"
          :aria-label="`${group.title} 工具授权`"
        >
          <header class="permission-work-header">
            <h4 class="permission-work-title">{{ group.title }}</h4>
            <span v-if="group.trashed" class="settings-dropdown-item-badge">回收站</span>
          </header>
          <ul class="permission-rule-list">
            <li v-for="item in group.items" :key="item.id" class="permission-rule-row">
              <div class="settings-model-copy">
                <template v-if="item.capability === 'fs_read'">
                  <span>{{ item.pathKind === 'file' ? '允许读取文件' : '允许读取目录' }}</span>
                  <code>{{ item.path }}</code>
                </template>
                <template v-else>
                  <span>{{ item.toolName ? '允许调用 MCP 工具' : '允许调用 MCP 服务的全部工具' }}</span>
                  <code>{{ item.toolName ? `${item.serverName} / ${item.toolName}` : item.serverName }}</code>
                </template>
              </div>
              <AppButton
                type="button"
                size="sm"
                variant="outline"
                :disabled="revokingId === item.id"
                @click="revoke(item.id)"
              >
                撤销
              </AppButton>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped lang="scss">
.permission-settings {
  @apply flex flex-col gap-4;
}

.permission-work-groups {
  @apply flex flex-col gap-5;
}

.permission-work-group {
  @apply flex flex-col gap-2;
}

.permission-work-header {
  @apply flex items-center gap-2;
}

.permission-work-title {
  @apply m-0 font-semibold;
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}

.permission-rule-list {
  @apply m-0 flex list-none flex-col divide-y border p-0;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.permission-rule-row {
  @apply flex items-center justify-between gap-4 px-3.5 py-2.5;

  border-color: var(--border-subtle);
}
</style>
