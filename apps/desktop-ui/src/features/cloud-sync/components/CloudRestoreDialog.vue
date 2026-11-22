<script setup lang="ts">
import { computed, ref } from 'vue';

import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog, AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';

import { formatSize, formatWhen } from '../presentation';
import { type CloudBackupItem, useCloudSyncStore } from '../store';

const emit = defineEmits<{
  /** 作品包已下载到本机临时路径，交给作品包导入流程。 */
  restore: [path: string];
}>();
const cloud = useCloudSyncStore();
const groups = computed(() =>
  CLOUD_PROVIDERS.map(provider => ({
    provider,
    label: CLOUD_PROVIDER_LABELS[provider],
    items: cloud.backups.filter(item => item.provider === provider)
  })).filter(group => group.items.length > 0)
);
// 确认框先关闭再派发 confirm，目标与开关分开保存。
const deleting = ref<CloudBackupItem | null>(null);
const deleteOpen = ref(false);

function details(item: CloudBackupItem) {
  return [
    ...(item.modifiedAt ? [formatWhen(item.modifiedAt)] : []),
    ...(item.size === undefined ? [] : [formatSize(item.size)])
  ].join(' · ');
}
function isTransferring(item: CloudBackupItem, action: 'download' | 'delete') {
  const transfer = cloud.transferring;
  return transfer?.action === action && transfer.item.provider === item.provider && transfer.item.id === item.id;
}
async function restore(item: CloudBackupItem) {
  const path = await cloud.downloadBackup(item);
  if (!path) return;
  cloud.setRestoreOpen(false);
  emit('restore', path);
}
function askDelete(item: CloudBackupItem) {
  deleting.value = item;
  deleteOpen.value = true;
}
</script>

<template>
  <AppDialog
    :open="cloud.restoreOpen"
    title="从云端恢复"
    description="选择一个作品包。作品库已有同一部作品时，可以另存为副本或覆盖原作品。"
    @update:open="cloud.setRestoreOpen"
  >
    <p v-if="cloud.backupsLoading" class="restore-muted" role="status">正在读取云端的作品包…</p>
    <AppScrollArea v-else class="restore-scroll" viewport-class="pl-1 pr-3">
      <p v-if="!groups.length && !cloud.backupsError" class="restore-muted">
        云端还没有作品包。可从作品库的作品菜单发起备份。
      </p>
      <section v-for="group in groups" :key="group.provider" :aria-label="group.label" class="restore-group">
        <h3 class="restore-provider">{{ group.label }}</h3>
        <ul class="restore-list">
          <li v-for="item in group.items" :key="item.id" class="restore-item">
            <div class="restore-copy">
              <span class="restore-name">{{ item.name }}</span>
              <span v-if="item.summary" class="restore-muted">
                {{ item.summary.manuscripts }} 篇文稿 · {{ item.summary.resources }} 项资料<template
                  v-if="item.summary.images"
                  >（含 {{ item.summary.images }} 张图片）</template
                >
              </span>
              <span v-if="item.modifiedAt || item.size !== undefined" class="restore-muted">{{ details(item) }}</span>
            </div>
            <AppButton
              variant="secondary"
              :disabled="cloud.transferring !== null"
              :aria-label="`恢复 ${item.name}（${group.label}）`"
              @click="restore(item)"
              >{{ isTransferring(item, 'download') ? '正在下载…' : '恢复' }}</AppButton
            >
            <AppButton
              variant="ghost"
              :disabled="cloud.transferring !== null"
              :aria-label="`删除 ${item.name}（${group.label}）`"
              @click="askDelete(item)"
              >{{ isTransferring(item, 'delete') ? '正在删除…' : '删除' }}</AppButton
            >
          </li>
        </ul>
      </section>
      <p v-if="cloud.backupsError" class="restore-error" role="alert">{{ cloud.backupsError }}</p>
    </AppScrollArea>
  </AppDialog>
  <AppAlertDialog
    v-model:open="deleteOpen"
    :title="deleting ? `从 ${CLOUD_PROVIDER_LABELS[deleting.provider]} 删除“${deleting.name}”？` : ''"
    description="这份作品包会从云端应用目录里删除，本机的作品不受影响。"
    confirm-label="删除"
    @confirm="deleting && cloud.deleteBackup(deleting)"
  />
</template>

<style scoped lang="scss">
.restore-scroll {
  @apply -mx-1;
  max-height: min(24rem, calc(100vh - 10rem));
}
.restore-group {
  @apply mt-3;
}
.restore-provider {
  @apply m-0 font-semibold;
  font-size: var(--ui-caption-size);
}
.restore-list {
  @apply m-0 grid list-none p-0;
}
.restore-item {
  @apply flex min-w-0 items-center gap-2 border-b py-2;
  border-color: var(--border-subtle);
}
.restore-item:last-child {
  @apply border-b-0;
}
.restore-copy {
  @apply grid min-w-0 flex-1 gap-1;
}
.restore-name {
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}
.restore-muted {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-variant-numeric: tabular-nums;
}
.restore-error {
  color: var(--destructive);
}
</style>
