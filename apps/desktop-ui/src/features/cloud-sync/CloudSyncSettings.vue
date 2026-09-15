<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  AUTO_BACKUP_INTERVAL_MINUTES,
  CLOUD_PROVIDER_LABELS,
  type CloudBackupArchive,
  type CloudProvider
} from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppNumberInput } from '@/components/AppNumberInput';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import { describeBackupInterval, formatSize, formatWhen, isValidBackupInterval } from './presentation';
import RestoreWizard from './RestoreWizard.vue';
import { useCloudSyncStore } from './store';

const cloud = useCloudSyncStore();
const settings = useSettingsStore();
let unsubscribe: (() => void) | undefined;

/** 写明应用能看到云端的哪一块，比一句"连接云盘"更让人敢按下去。 */
const providerNotes: Record<CloudProvider, string> = {
  dropbox: '应用专属目录 /Apps/Chaptale/：只读写这一块，看不到你云盘里的其他文件。',
  onedrive: '应用专属文件夹：只读写这一块，看不到你云盘里的其他文件。'
};

const providers = computed(() =>
  cloud.availability.map(item => ({
    ...item,
    label: CLOUD_PROVIDER_LABELS[item.provider],
    note: providerNotes[item.provider],
    account: cloud.accounts.find(account => account.provider === item.provider) ?? null
  }))
);

const browsingLabel = computed(() => (cloud.browseProvider ? CLOUD_PROVIDER_LABELS[cloud.browseProvider] : ''));
const busyLabel = computed(() => (cloud.busy ? `正在等待 ${CLOUD_PROVIDER_LABELS[cloud.busy]} 授权` : ''));
const bindingLabel = computed(() => (cloud.binding ? CLOUD_PROVIDER_LABELS[cloud.binding.provider] : ''));

const progressLabel = computed(() => cloud.progressLabel);

/** 配额是服务商的附加信息：拿不到就说"未提供"，不显示一个像模像样的假进度条。 */
const quotaLabel = computed(() =>
  cloud.quota
    ? `云端占用 ${formatSize(cloud.quota.usedBytes)} / ${formatSize(cloud.quota.totalBytes)}`
    : '云端配额：服务商未提供'
);

/**
 * 自动备份的两个字段直接落设置，不做草稿：和编辑器那个「自动保存」开关同一形状，
 * 拨一下就该算数——它不涉及需要一次性校验的一批字段。
 */
const autoBackupEnabled = computed({
  get: () => settings.state?.settings.backup?.auto ?? true,
  set: (value: boolean) => void settings.update({ backup: { auto: value } })
});

/**
 * 间隔输入框的本地草稿。
 *
 * 数字输入框在打字过程中会发出暂态值（打 1440 的中途先出来 1、14），而 IPC 面只收
 * 30–43200 的整数（合约里的 validator 守着入口）：所以**只把合法的值落盘**，
 * 其余留在本地并就地说明。不这么做，作者每敲一个键都会收到一次“IPC 参数无效”。
 */
const intervalDraft = ref<number | undefined>(undefined);

watch(
  () => settings.state?.settings.backup?.intervalMinutes,
  value => {
    intervalDraft.value = isValidBackupInterval(value) ? value : AUTO_BACKUP_INTERVAL_MINUTES.default;
  },
  { immediate: true }
);

function changeInterval(value: number | undefined) {
  intervalDraft.value = value;

  if (isValidBackupInterval(value)) void settings.update({ backup: { intervalMinutes: value } });
}

/** 提示行同时承担两件事：合法时说人话（“每天一次”），不合法时说怎么填。 */
const intervalHint = computed(() => {
  if (isValidBackupInterval(intervalDraft.value)) return describeBackupInterval(intervalDraft.value);

  return `请填 ${AUTO_BACKUP_INTERVAL_MINUTES.min} 到 ${AUTO_BACKUP_INTERVAL_MINUTES.max} 之间的整数分钟`;
});

const intervalInvalid = computed(
  () => typeof intervalDraft.value === 'number' && !isValidBackupInterval(intervalDraft.value)
);
const lastBackupLabel = computed(() =>
  cloud.lastBackupAt ? `本机上次备份 ${formatWhen(cloud.lastBackupAt)}` : '本机还没备份过'
);

onMounted(() => {
  if (!hasDesktopApi()) return;

  void cloud.load();
  void cloud.loadBackups();
  unsubscribe = getDesktopApi().cloudSync.onBackupProgress(progress => cloud.applyProgress(progress));
});

onUnmounted(() => unsubscribe?.());

/** 模板里不直接读 browseProvider：把窄化收在函数里，省得每个调用点各保证一次非空。 */
function browse(parentId: string | null) {
  if (!cloud.browseProvider) return;

  void cloud.openFolder(cloud.browseProvider, parentId);
}

/** 把当前浏览到的目录用作备份位置；`id` 为 null 表示作者选的是最顶层。 */
function bindHere() {
  const listing = cloud.listing;

  if (!cloud.browseProvider || !listing) return;

  void cloud.bind(cloud.browseProvider, listing.current.id, listing.current.name);
}

function confirmRemoval() {
  const archiveIds = [...removalSelection.value];

  removalSelection.value = [];
  void cloud.removeBackups(archiveIds);
}

/**
 * 勾选与“待确认”都是这一屏的事，不进 store。
 *
 * 删除本身在 store 里；进 store 的只是“删哪几份”——把勾选一并放进去，
 * 会让另一个面板打开时也看到上一次的勾选。
 */
const removalSelection = ref<string[]>([]);
const isRemovalPending = ref(false);

/**
 * 按复选报上来的**值**决定选中与否，而不是“收到一次事件就翻转”。
 *
 * 复选会在初始化与失焦时重复报同一个值：把每次事件都当翻转，
 * 作者点“删除所选”的那一刻（按钮夺走焦点）就会把自己的选择翻掉、确认页自己消失。
 * 没有真变化就不算一次新意图，也就不会把确认页收回去。
 */
function setRemoval(item: CloudBackupArchive, selected: boolean) {
  const next = selected
    ? removalSelection.value.includes(item.id)
      ? removalSelection.value
      : [...removalSelection.value, item.id]
    : removalSelection.value.filter(id => id !== item.id);

  if (next === removalSelection.value) return;

  // 换一次选择就当作换了一次意图：上一次的确认页不能继续挂着。
  isRemovalPending.value = false;
  removalSelection.value = next;
}

const selectionLabel = computed(() => `已选 ${removalSelection.value.length} 份 · 共 ${cloud.archives.length} 份`);

function formatTime(value: string): string {
  return formatWhen(value);
}
</script>

<template>
  <SettingsSection
    title="云端备份"
    title-id="settings-cloud-sync-title"
    description="登录云服务商后，可把作品备份到云端并在需要时恢复。凭据经系统密钥环加密后只留在本机，账号密码不下发到界面。"
  >
    <div class="cloud-sync">
      <section class="cloud-card" aria-labelledby="cloud-accounts-title">
        <div class="cloud-card-heading">
          <h4 id="cloud-accounts-title">账户</h4>
          <AppButton variant="ghost" size="sm" type="button" :disabled="cloud.isLoading" @click="cloud.load()">
            <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />刷新
          </AppButton>
        </div>

        <p v-if="cloud.isLoading && !cloud.state" class="cloud-muted" role="status">正在读取登录状态…</p>
        <ul v-else class="cloud-providers">
          <li v-for="item in providers" :key="item.provider" class="cloud-provider">
            <div class="cloud-provider-copy">
              <div class="cloud-provider-title">
                <strong>{{ item.label }}</strong>
                <span v-if="item.account" class="cloud-state is-online">
                  <span class="i-mingcute-check-line size-3.5" aria-hidden="true" />{{ item.account.displayName }}
                </span>
                <span v-else-if="item.configured" class="cloud-state">未登录</span>
                <span v-else class="cloud-state">未配置</span>
              </div>
              <p class="cloud-note">{{ item.note }}</p>
            </div>
            <div class="cloud-provider-actions">
              <AppButton
                v-if="item.account"
                variant="ghost"
                size="sm"
                type="button"
                :disabled="cloud.busy !== null"
                @click="cloud.signOut(item.provider)"
              >
                退出登录
              </AppButton>
              <AppButton
                v-else-if="item.configured"
                size="sm"
                type="button"
                :disabled="cloud.busy !== null"
                @click="cloud.signIn(item.provider)"
              >
                <span class="i-mingcute-lock-line size-4" aria-hidden="true" />登录
              </AppButton>
              <AppButton
                v-if="item.account"
                variant="ghost"
                size="sm"
                type="button"
                @click="cloud.openFolder(item.provider, null)"
              >
                <span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true" />云端目录
              </AppButton>
            </div>
          </li>
        </ul>

        <p v-if="cloud.busy" class="cloud-pending" role="status">
          <span>{{ busyLabel }}…请在浏览器里完成授权</span>
          <AppButton variant="ghost" size="sm" type="button" @click="cloud.cancelSignIn()">取消</AppButton>
        </p>
        <p v-if="cloud.error" class="cloud-error" role="alert">{{ cloud.error }}</p>
      </section>

      <section v-if="cloud.browseProvider" class="cloud-card" aria-labelledby="cloud-browser-title">
        <div class="cloud-card-heading">
          <h4 id="cloud-browser-title">云端目录 · {{ browsingLabel }}</h4>
          <div class="cloud-provider-actions">
            <AppButton
              v-if="cloud.listing && !cloud.listing.current.root"
              variant="ghost"
              size="sm"
              type="button"
              @click="browse(cloud.listing.parentId)"
            >
              <span class="i-mingcute-arrow-left-line size-4" aria-hidden="true" />上一级
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              :disabled="cloud.isListingLoading"
              @click="browse(cloud.listing?.current.id ?? null)"
            >
              <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />刷新
            </AppButton>
            <AppButton variant="ghost" size="sm" type="button" @click="cloud.closeFolder()">收起</AppButton>
          </div>
        </div>

        <p v-if="cloud.isListingLoading && !cloud.listing" class="cloud-muted" role="status">正在读取云端目录…</p>
        <template v-else-if="cloud.listing">
          <p class="cloud-path">
            {{ cloud.listing.current.name }}
            <span v-if="cloud.listing.current.root" class="cloud-muted">· 应用最顶层</span>
          </p>
          <p v-if="!cloud.listing.folders.length" class="cloud-muted">这个目录下还没有子目录。</p>
          <ul v-else class="cloud-providers">
            <li v-for="folder in cloud.listing.folders" :key="folder.name">
              <AppButton variant="ghost" class="cloud-folder" type="button" @click="browse(folder.id)">
                <span class="i-mingcute-folder-2-line size-4" aria-hidden="true" />{{ folder.name }}
              </AppButton>
            </li>
          </ul>
          <div class="cloud-provider-actions is-end">
            <AppButton size="sm" type="button" :disabled="cloud.isBackupLoading" @click="bindHere()">
              <span class="i-mingcute-check-line size-4" aria-hidden="true" />用作备份位置
            </AppButton>
          </div>
        </template>
        <p v-if="cloud.listingError" class="cloud-error" role="alert">{{ cloud.listingError }}</p>
      </section>

      <section class="cloud-card" aria-labelledby="cloud-backup-title">
        <div class="cloud-card-heading">
          <h4 id="cloud-backup-title">云端备份</h4>
          <div class="cloud-provider-actions">
            <AppButton
              v-if="cloud.binding"
              size="sm"
              type="button"
              :disabled="cloud.isBackupRunning"
              @click="cloud.createBackup()"
            >
              <span class="i-mingcute-cloud-line size-4" aria-hidden="true" />立即备份
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              :disabled="cloud.isBackupLoading"
              @click="cloud.loadBackups()"
            >
              <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />刷新
            </AppButton>
          </div>
        </div>

        <p v-if="cloud.isBackupRunning" class="cloud-pending" role="status">{{ progressLabel }}</p>

        <template v-if="cloud.binding">
          <p class="cloud-path">
            {{ cloud.binding.folderName }}
            <span class="cloud-muted">· {{ bindingLabel }} · 绑定于 {{ formatTime(cloud.binding.boundAt) }}</span>
          </p>
          <p class="cloud-muted">{{ quotaLabel }}</p>

          <div class="cloud-auto">
            <label class="cloud-auto-row">
              <AppCheckbox v-model="autoBackupEnabled" aria-label="自动备份" />
              <span>自动备份</span>
            </label>
            <div class="cloud-auto-row">
              <span>每隔</span>
              <AppNumberInput
                :model-value="intervalDraft"
                class="cloud-auto-interval"
                :min="AUTO_BACKUP_INTERVAL_MINUTES.min"
                :max="AUTO_BACKUP_INTERVAL_MINUTES.max"
                :disabled="!autoBackupEnabled"
                :invalid="intervalInvalid"
                aria-label="自动备份间隔（分钟）"
                @update:model-value="changeInterval"
              />
              <span :class="{ 'cloud-error': intervalInvalid }">分钟 · {{ intervalHint }}</span>
            </div>
            <p class="cloud-muted">
              自动备份只在应用开着、且打开的就是这部作品时执行；到点时正在备份或恢复就跳过这一回。
              {{ lastBackupLabel }}。
            </p>
            <p v-if="cloud.lastBackupError" class="cloud-error" role="alert">
              上次自动备份失败：{{ cloud.lastBackupError.message }}（{{ formatWhen(cloud.lastBackupError.at) }}）
            </p>
          </div>

          <p v-if="!cloud.archives.length" class="cloud-muted">云端还没有归档。点「立即备份」把当前作品打一份上去。</p>
          <template v-else>
            <div class="cloud-files-head">
              <span class="cloud-muted">{{ selectionLabel }}</span>
              <div class="cloud-provider-actions">
                <template v-if="isRemovalPending">
                  <AppButton size="sm" type="button" :disabled="cloud.isBackupRunning" @click="confirmRemoval()">
                    确认删除 {{ removalSelection.length }} 份
                  </AppButton>
                  <AppButton variant="ghost" size="sm" type="button" @click="isRemovalPending = false">取消</AppButton>
                </template>
                <AppButton
                  v-else
                  variant="ghost"
                  size="sm"
                  type="button"
                  :disabled="removalSelection.length === 0 || cloud.isBackupRunning"
                  @click="isRemovalPending = true"
                >
                  删除所选
                </AppButton>
              </div>
            </div>
            <p v-if="isRemovalPending" class="cloud-error" role="alert">
              从云端删除后无法恢复，请确认这 {{ removalSelection.length }} 份归档不再需要。
            </p>

            <ul class="cloud-files">
              <li v-for="item in cloud.archives" :key="item.id" class="cloud-file">
                <label class="cloud-file-copy">
                  <AppCheckbox
                    :model-value="removalSelection.includes(item.id)"
                    :aria-label="`选择归档 ${item.name}`"
                    @update:model-value="setRemoval(item, $event === true)"
                  />
                  <span class="cloud-file-name">{{ item.name }}</span>
                  <span class="cloud-muted">
                    {{ formatSize(item.sizeBytes) }}
                    <template v-if="item.modifiedAt"> · {{ formatTime(item.modifiedAt) }}</template>
                  </span>
                </label>
                <div class="cloud-provider-actions">
                  <AppButton
                    variant="ghost"
                    size="sm"
                    type="button"
                    :disabled="cloud.isBackupRunning"
                    @click="cloud.openRestore(item.id, item.name)"
                  >
                    恢复…
                  </AppButton>
                </div>
              </li>
            </ul>
          </template>

          <div class="cloud-provider-actions is-end">
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              :disabled="cloud.isBackupRunning"
              @click="cloud.unbind()"
            >
              解除绑定
            </AppButton>
          </div>
        </template>
        <p v-else class="cloud-muted">
          这部作品还没有绑定云端备份位置。先在上面的账户行点「云端目录」，选好位置后点「用作备份位置」。绑定只影响这台机器，云端归档不会因此被删。
        </p>

        <p v-if="cloud.backupError" class="cloud-error" role="alert">{{ cloud.backupError }}</p>
        <p v-if="cloud.notice" class="cloud-notice" role="status">{{ cloud.notice }}</p>
      </section>
    </div>
  </SettingsSection>

  <RestoreWizard />
</template>

<style scoped lang="scss">
.cloud-sync {
  @apply grid gap-3;
  font-size: var(--ui-font-size);
}

.cloud-card {
  @apply grid gap-2 border p-3;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.cloud-card-heading {
  @apply flex min-w-0 items-center justify-between gap-3;
}

h4 {
  @apply m-0 text-sm font-semibold;
}

.cloud-providers,
.cloud-files {
  @apply m-0 grid list-none gap-2 p-0;
}

.cloud-provider,
.cloud-file {
  @apply min-w-0 border-b pb-2;
  border-color: var(--border-subtle);
}

.cloud-provider {
  @apply flex items-start justify-between gap-3;
}

.cloud-provider:last-child,
.cloud-file:last-child {
  @apply border-b-0 pb-0;
}

.cloud-file {
  @apply grid gap-1;
}

.cloud-files-head {
  @apply flex min-w-0 items-center justify-between gap-2;
}

.cloud-file-copy {
  @apply grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5;
}

.cloud-file-name {
  overflow-wrap: anywhere;
}

.cloud-provider-copy {
  @apply grid min-w-0 gap-1;
}

.cloud-provider-title {
  @apply flex min-w-0 flex-wrap items-center gap-2;
}

.cloud-provider-actions {
  @apply flex shrink-0 items-center gap-1;
}

.cloud-provider-actions.is-end {
  @apply justify-end;
}

.cloud-state {
  @apply inline-flex items-center gap-1;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}

.cloud-state.is-online {
  color: var(--primary-solid);
}

.cloud-note,
.cloud-muted,
.cloud-path {
  @apply m-0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}

.cloud-path {
  overflow-wrap: anywhere;
}

.cloud-pending {
  @apply m-0 flex items-center justify-between gap-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}

.cloud-error {
  @apply m-0;
  color: var(--destructive);
  font-size: var(--ui-caption-size);
}

.cloud-notice {
  @apply m-0;
  color: var(--primary-solid);
  font-size: var(--ui-caption-size);
}

.cloud-folder {
  @apply h-auto min-h-8 w-full min-w-0 justify-start gap-2 px-1 py-1 text-left;
}

.cloud-auto {
  @apply grid gap-1 border-t pt-2;
  border-color: var(--border-subtle);
}

.cloud-auto-row {
  @apply flex items-center gap-2;
}

.cloud-auto-interval {
  width: 6.5rem;
}

@media (max-width: 640px) {
  .cloud-provider {
    @apply flex-wrap;
  }
}
</style>
