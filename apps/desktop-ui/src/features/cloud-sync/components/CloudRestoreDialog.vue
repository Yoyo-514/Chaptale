<script setup lang="ts">
import { computed, ref } from 'vue';

import { CLOUD_PROVIDER_LABELS } from '@chaptale/desktop/bridge';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog, AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';

import { formatSize, formatWhen } from '../presentation';
import { type CloudBackupItem, useCloudSyncStore } from '../store';

const emit = defineEmits<{
  /** 作品包已下载到本机临时路径，交给作品包导入流程。 */
  restore: [path: string];
}>();
const cloud = useCloudSyncStore();
/** 点开过“其余 N 份”的作品。 */
const expanded = ref(new Set<string>());

type Row = { item: CloudBackupItem; title: string; lines: string[] };

function row(item: CloudBackupItem): Row {
  const provider = CLOUD_PROVIDER_LABELS[item.provider];
  const size = item.size === undefined ? [] : [formatSize(item.size)];
  if (!item.info) {
    const when = item.modifiedAt ? [formatWhen(item.modifiedAt)] : [];
    return { item, title: item.name, lines: [[provider, ...when, ...size].join(' · ')] };
  }
  const { at, kind, device, summary } = item.info;
  const images = summary.images ? `（含 ${summary.images} 张图片）` : '';
  return {
    item,
    title: formatWhen(at),
    lines: [
      [kind === 'auto' ? '自动' : '手动', device, provider].join(' · '),
      [`${summary.manuscripts} 篇文稿`, `${summary.resources} 项资料${images}`, ...size].join(' · ')
    ]
  };
}

/** 按作品分组，组内新的在前（store 已排好）；名字认不出的包单独一组，排在最后。 */
const groups = computed(() => {
  const works = new Map<string, { id: string; label: string; rows: Row[]; hidden: number }>();
  const others: Row[] = [];
  for (const item of cloud.backups) {
    if (!item.info) {
      others.push(row(item));
      continue;
    }
    const { workId, title } = item.info;
    const group = works.get(workId) ?? { id: workId, label: `《${title}》`, rows: [], hidden: 0 };
    works.set(workId, group);
    if (!group.rows.length || expanded.value.has(workId)) group.rows.push(row(item));
    else group.hidden++;
  }
  return [...works.values(), ...(others.length ? [{ id: '', label: '其他作品包', rows: others, hidden: 0 }] : [])];
});
// 确认框先关闭再派发 confirm，目标与开关分开保存。
const deleting = ref<Row | null>(null);
const deleteOpen = ref(false);

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
function askDelete(target: Row) {
  deleting.value = target;
  deleteOpen.value = true;
}
function openAccounts() {
  cloud.setRestoreOpen(false);
  cloud.openAccountSettings();
}
</script>

<template>
  <AppDialog
    :open="cloud.restoreOpen"
    title="从云端恢复"
    description="选择一份备份。作品库已有同一部作品时，可以另存为副本或覆盖原作品。"
    @update:open="cloud.setRestoreOpen"
  >
    <p v-if="cloud.backupsLoading || cloud.isLoading" class="restore-muted" role="status">正在读取云端的备份…</p>
    <div v-else-if="!cloud.accounts.length" class="restore-empty">
      <p class="restore-muted">还没有登录云端账户。</p>
      <AppButton variant="secondary" @click="openAccounts">打开云端账户</AppButton>
    </div>
    <template v-else>
      <p v-if="cloud.backupsError" class="restore-error" role="alert">{{ cloud.backupsError }}</p>
      <p v-else-if="!groups.length" class="restore-muted">云端还没有备份。可从作品库的作品菜单发起备份。</p>
      <AppScrollArea class="restore-scroll" viewport-class="pl-1 pr-3">
        <section v-for="group in groups" :key="group.id" :aria-label="group.label" class="restore-group">
          <h3 class="restore-work">{{ group.label }}</h3>
          <ul class="restore-list">
            <li v-for="entry in group.rows" :key="entry.item.provider + entry.item.id" class="restore-item">
              <div class="restore-copy">
                <span class="restore-name">{{ entry.title }}</span>
                <span v-for="line in entry.lines" :key="line" class="restore-muted">{{ line }}</span>
              </div>
              <AppButton
                variant="secondary"
                :disabled="cloud.transferring !== null"
                :aria-label="`恢复 ${group.label} ${entry.title}（${CLOUD_PROVIDER_LABELS[entry.item.provider]}）`"
                @click="restore(entry.item)"
                >{{ isTransferring(entry.item, 'download') ? '正在下载…' : '恢复' }}</AppButton
              >
              <AppTooltip :text="isTransferring(entry.item, 'delete') ? '正在删除…' : '从云端删除'">
                <AppButton
                  icon
                  variant="ghost"
                  :disabled="cloud.transferring !== null"
                  :aria-label="`删除 ${group.label} ${entry.title}（${CLOUD_PROVIDER_LABELS[entry.item.provider]}）`"
                  @click="askDelete(entry)"
                  ><span class="i-mingcute-delete-2-line size-4" aria-hidden="true"
                /></AppButton>
              </AppTooltip>
            </li>
          </ul>
          <AppButton v-if="group.hidden" size="xs" variant="ghost" @click="expanded.add(group.id)"
            >其余 {{ group.hidden }} 份</AppButton
          >
        </section>
      </AppScrollArea>
    </template>
  </AppDialog>
  <AppAlertDialog
    v-model:open="deleteOpen"
    :title="deleting ? `从 ${CLOUD_PROVIDER_LABELS[deleting.item.provider]} 删除这份备份？` : ''"
    :description="deleting ? [deleting.title, ...deleting.lines].join(' · ') + '。本机的作品不受影响。' : ''"
    confirm-label="删除"
    @confirm="deleting && cloud.deleteBackup(deleting.item)"
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
.restore-work {
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
.restore-empty {
  @apply grid justify-items-start gap-2;
}
.restore-error {
  color: var(--destructive);
}
</style>
