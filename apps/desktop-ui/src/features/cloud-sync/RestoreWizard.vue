<script setup lang="ts">
import { computed } from 'vue';

import type { CloudRestoreChoice, CloudRestoreMode } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';
import { AppScrollArea } from '@/components/AppScrollArea';

import { formatSize } from './presentation';
import { useCloudSyncStore } from './store';

const cloud = useCloudSyncStore();

const wizard = computed(() => cloud.wizard);
const plan = computed(() => cloud.wizard?.plan ?? null);
/** 只列归档里有的文件：本地独有的一律保留，不必逐条占用作者的注意力。 */
const entries = computed(() => plan.value?.entries ?? []);
const authorConflicts = computed(() => entries.value.filter(entry => entry.verdict === 'conflict' && !entry.system));
const systemConflicts = computed(() => entries.value.filter(entry => entry.verdict === 'conflict' && entry.system));
const conflicts = computed(() => [...authorConflicts.value, ...systemConflicts.value]);

/** 计划摘要：四类动作各给一个数，只有“冲突”是风险色。 */
const stats = computed(() => [
  {
    key: 'add',
    value: entries.value.filter(entry => entry.verdict === 'add').length,
    label: '新增',
    icon: 'i-mingcute-new-folder-line',
    risk: false
  },
  {
    key: 'identical',
    value: entries.value.filter(entry => entry.verdict === 'identical').length,
    label: '一致',
    icon: 'i-mingcute-check-line',
    risk: false
  },
  {
    key: 'conflict',
    value: conflicts.value.length,
    label: '冲突',
    icon: 'i-mingcute-warning-line',
    risk: conflicts.value.length > 0
  },
  { key: 'local', value: plan.value?.localOnly ?? 0, label: '本地独有', icon: 'i-mingcute-file-line', risk: false }
]);

const modes: { value: CloudRestoreMode; icon: string; title: string; detail: string }[] = [
  {
    value: 'new',
    icon: 'i-mingcute-new-folder-line',
    title: '新增',
    detail: '解包到作品旁边的新目录，当前作品一个字节都不动'
  },
  {
    value: 'overwrite',
    icon: 'i-mingcute-transfer-line',
    title: '覆盖',
    detail: '原地还原：只写归档里有的文件，本地独有的保留，先留还原前快照'
  },
  {
    value: 'merge',
    icon: 'i-mingcute-list-check-line',
    title: '合并',
    detail: '逐文件挑选：两边不同的由你一项项决定'
  }
];

const choices: { value: CloudRestoreChoice; label: string }[] = [
  { value: 'archive', label: '用归档' },
  { value: 'local', label: '用本地' },
  { value: 'both', label: '两个都留' }
];

function choiceOf(relativePath: string): CloudRestoreChoice | '' {
  return wizard.value?.choices[relativePath] ?? '';
}

/** 身份问题在计划那里已经说过一次，模式那边就只说“这一次为什么按不下去”。 */
const modeNote = computed(() => (plan.value && !plan.value.identityMatches ? '' : cloud.restoreBlockedReason));

function confirmLabel(mode: CloudRestoreMode): string {
  if (mode === 'new') return '解包到新目录';
  if (mode === 'overwrite') return '原地覆盖（先留快照）';

  return '按选择写入';
}
</script>

<template>
  <AppDialog
    :open="Boolean(wizard)"
    title="恢复云端备份"
    content-size="lg"
    :description="wizard ? `归档：${wizard.archiveName}` : undefined"
    @update:open="open => !open && cloud.closeRestore()"
  >
    <div class="restore">
      <p v-if="cloud.isPlanLoading" class="restore-loading" role="status">
        <span class="i-mingcute-refresh-3-line size-4 animate-spin" aria-hidden="true" />
        正在读取归档并与当前作品比对…
      </p>

      <template v-else-if="wizard && plan">
        <!-- 回执是结果页：下过的决定已经落到磁盘，模式与冲突清单不再可改，也不再占位置。 -->
        <template v-if="!wizard.receipt">
          <!-- 计划摘要：先让作者看到“这次会动什么”，再决定怎么动。 -->
          <section class="restore-block" aria-labelledby="restore-plan-title">
            <h4 id="restore-plan-title" class="restore-heading">这次恢复会动什么</h4>
            <ul class="restore-stats">
              <li v-for="stat in stats" :key="stat.key" class="restore-stat" :class="{ 'is-risk': stat.risk }">
                <span class="restore-stat-icon">
                  <span :class="stat.icon" class="size-4" aria-hidden="true" />
                  <span class="restore-stat-value">{{ stat.value }}</span>
                </span>
                <span class="restore-stat-label">{{ stat.label }}</span>
              </li>
            </ul>
            <p v-if="plan.emptyDirectories.length > 0" class="restore-note">
              <span class="i-mingcute-folder-line size-3.5" aria-hidden="true" />
              归档里还有 {{ plan.emptyDirectories.length }} 个空目录，会一并建出来
            </p>
            <p v-if="!plan.identityMatches" class="restore-note is-blocked" role="alert">
              <span class="i-mingcute-lock-line size-3.5" aria-hidden="true" />
              这份归档不能自证是当前作品（归档里没有 chaptale.json 或身份对不上），只能恢复到新目录
            </p>
          </section>

          <!-- 模式：默认停在零风险的新增，另外两个得由作者主动点。 -->
          <section class="restore-block" aria-labelledby="restore-mode-title">
            <h4 id="restore-mode-title" class="restore-heading">怎么恢复</h4>
            <div class="restore-modes" role="radiogroup" aria-labelledby="restore-mode-title">
              <button
                v-for="mode in modes"
                :key="mode.value"
                type="button"
                class="restore-mode"
                :class="{ 'is-active': wizard.mode === mode.value }"
                :disabled="mode.value !== 'new' && !plan.identityMatches"
                :title="mode.value !== 'new' && !plan.identityMatches ? '这份归档不能自证是当前作品' : undefined"
                role="radio"
                :aria-checked="wizard.mode === mode.value"
                @click="cloud.setRestoreMode(mode.value)"
              >
                <span class="restore-mode-head">
                  <span :class="mode.icon" class="size-4 shrink-0" aria-hidden="true" />
                  <strong>{{ mode.title }}</strong>
                  <span v-if="wizard.mode === mode.value" class="i-mingcute-check-line size-4" aria-hidden="true" />
                </span>
                <span class="restore-mode-detail">{{ mode.detail }}</span>
              </button>
            </div>
            <p v-if="modeNote" class="restore-note is-blocked" role="alert">
              <span class="i-mingcute-warning-line size-3.5" aria-hidden="true" />
              {{ modeNote }}
            </p>
          </section>

          <!-- 合并：逐项挑选，没决议的不会被写入。 -->
          <section v-if="wizard.mode === 'merge' && conflicts.length > 0" class="restore-block">
            <div class="restore-heading-row">
              <h4 class="restore-heading">两边不同的文件</h4>
              <span class="restore-badge">{{ conflicts.length }}</span>
            </div>

            <div v-if="systemConflicts.length > 0" class="restore-group">
              <span class="i-mingcute-folder-line size-4 shrink-0" aria-hidden="true" />
              <strong>应用数据</strong>
              <span class="restore-group-note">`.chaptale/` · {{ systemConflicts.length }} 项</span>
              <div class="restore-group-actions">
                <AppButton
                  variant="ghost"
                  size="xs"
                  type="button"
                  @click="
                    cloud.setRestoreChoices(
                      systemConflicts.map(entry => entry.relativePath),
                      'local'
                    )
                  "
                  >统一用本地</AppButton
                >
                <AppButton
                  variant="ghost"
                  size="xs"
                  type="button"
                  @click="
                    cloud.setRestoreChoices(
                      systemConflicts.map(entry => entry.relativePath),
                      'archive'
                    )
                  "
                  >统一用归档</AppButton
                >
              </div>
            </div>

            <AppScrollArea class="restore-list">
              <ul class="restore-conflicts">
                <li v-for="entry in conflicts" :key="entry.relativePath" class="restore-conflict">
                  <div class="restore-conflict-head">
                    <span
                      :class="entry.system ? 'i-mingcute-folder-line' : 'i-mingcute-file-line'"
                      class="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="restore-path" :title="entry.relativePath">{{ entry.relativePath }}</span>
                    <span class="restore-delta">
                      <span class="restore-delta-label">归档</span>
                      <span class="restore-delta-value">{{ formatSize(entry.archiveBytes) }}</span>
                      <span class="i-mingcute-arrow-right-line size-3" aria-hidden="true" />
                      <span class="restore-delta-label">本地</span>
                      <span class="restore-delta-value">{{ formatSize(entry.localBytes ?? 0) }}</span>
                    </span>
                  </div>

                  <div class="restore-conflict-foot">
                    <div class="restore-segment" role="group" :aria-label="`${entry.relativePath} 用哪一份`">
                      <button
                        v-for="option in choices"
                        :key="option.value"
                        type="button"
                        class="restore-segment-item"
                        :class="{ 'is-active': choiceOf(entry.relativePath) === option.value }"
                        :aria-pressed="choiceOf(entry.relativePath) === option.value"
                        @click="cloud.setRestoreChoice(entry.relativePath, option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                    <AppButton
                      variant="ghost"
                      size="xs"
                      type="button"
                      :aria-expanded="wizard.diff?.relativePath === entry.relativePath"
                      @click="cloud.loadRestoreDiff(entry.relativePath)"
                    >
                      <span class="i-mingcute-git-compare-line size-3.5" aria-hidden="true" />
                      {{ wizard.diff?.relativePath === entry.relativePath ? '收起对比' : '对比' }}
                    </AppButton>
                  </div>

                  <div v-if="wizard.diff?.relativePath === entry.relativePath" class="restore-diff">
                    <AppDiffView
                      v-if="wizard.diff.text"
                      :original="wizard.diff.archiveText"
                      :modified="wizard.diff.localText"
                      original-label="归档版本"
                      modified-label="本地当前"
                    />
                    <p v-else class="restore-note">
                      <span class="i-mingcute-information-line size-3.5" aria-hidden="true" />
                      {{
                        wizard.diff.reason === 'binary'
                          ? '这不是文本文件，没法在应用内对比，只能选用哪一份'
                          : '文件太大，没法在应用内对比，只能选用哪一份'
                      }}
                    </p>
                  </div>
                </li>
              </ul>
            </AppScrollArea>

            <p v-if="cloud.pendingConflicts.length > 0" class="restore-note is-pending" role="status">
              <span class="i-mingcute-time-line size-3.5" aria-hidden="true" />
              还有 {{ cloud.pendingConflicts.length }} 项没决定，它们不会被写入，本地保持不动
            </p>
          </section>
        </template>

        <p v-if="cloud.backupError" class="restore-note is-blocked" role="alert">
          <span class="i-mingcute-warning-line size-3.5" aria-hidden="true" />
          {{ cloud.backupError }}
        </p>

        <!-- 回执：写完之后只说事实。 -->
        <section v-if="wizard.receipt" class="restore-block restore-receipt" aria-labelledby="restore-receipt-title">
          <h4 id="restore-receipt-title" class="restore-heading">
            <span class="i-mingcute-check-circle-line size-4" aria-hidden="true" />
            已恢复
          </h4>
          <dl class="restore-facts">
            <div>
              <dt>位置</dt>
              <dd>{{ wizard.receipt.targetPath }}</dd>
            </div>
            <div>
              <dt>写入</dt>
              <dd>{{ wizard.receipt.written }} 个文件</dd>
            </div>
            <div v-if="wizard.receipt.snapshotId">
              <dt>还原前快照</dt>
              <dd>{{ wizard.receipt.snapshotId }}</dd>
            </div>
            <div v-if="wizard.receipt.skipped.length > 0">
              <dt>未写入</dt>
              <dd>{{ wizard.receipt.skipped.map(item => item.relativePath).join('、') }}</dd>
            </div>
          </dl>
          <p class="restore-note">
            <span class="i-mingcute-information-line size-3.5" aria-hidden="true" />
            <span>
              <template v-if="wizard.receipt.snapshotId">
                覆盖前的内容在缓存目录的 restore-guard 里还有一份。
              </template>
              已经打开的干净文件由编辑器自己重新读盘；带未保存内容的缓冲不会被覆盖。
              <template v-if="wizard.receipt.mode === 'new'">
                新目录还没有云端绑定，可在「设置 › 云端备份」里绑到同一位置。
              </template>
            </span>
          </p>
        </section>
      </template>

      <p v-else-if="!cloud.isPlanLoading && cloud.backupError" class="restore-note is-blocked" role="alert">
        <span class="i-mingcute-warning-line size-3.5" aria-hidden="true" />
        {{ cloud.backupError }}
      </p>

      <footer v-if="wizard">
        <AppButton variant="ghost" type="button" @click="cloud.closeRestore()">
          {{ wizard.receipt ? '关闭' : '取消' }}
        </AppButton>
        <AppButton
          v-if="!wizard.receipt && plan"
          type="button"
          :disabled="cloud.isApplying || Boolean(cloud.restoreBlockedReason)"
          @click="cloud.applyRestore()"
        >
          {{ cloud.isApplying ? '正在恢复…' : confirmLabel(wizard.mode) }}
        </AppButton>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped lang="scss">
.restore {
  @apply flex min-h-0 flex-col gap-4 pt-4;
  font-size: var(--ui-font-size);
}
.restore-block {
  @apply grid min-w-0 gap-2;
}
.restore-heading,
.restore-heading-row {
  @apply flex min-w-0 items-center gap-2 text-sm font-medium;
}
.restore-heading-row {
  @apply justify-between;
}
.restore-heading {
  @apply m-0;
}
.restore-badge {
  @apply min-w-5 rounded-full px-1.5 text-center;

  background: var(--primary-solid);
  color: var(--primary-solid-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.25rem;
}
.restore-loading {
  @apply flex items-center gap-2;

  color: var(--muted-foreground);
}

/* 计划摘要：四个格子，只有“冲突”带风险色。 */
.restore-stats {
  @apply grid gap-2;
  grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
}
.restore-stat {
  @apply grid gap-0.5 px-3 py-2;

  background: var(--surface-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
.restore-stat.is-risk {
  background: var(--destructive-background);
  border-color: var(--destructive);
  color: var(--destructive-background-foreground);
}
.restore-stat-icon {
  @apply flex items-center gap-1.5;
}
.restore-stat-value {
  @apply text-lg font-medium leading-none;
}
.restore-stat-label {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.restore-stat.is-risk .restore-stat-label {
  color: inherit;
}

/* 提示条：空目录、“还有几项没决定”这类事实，不占正文的视觉重量。 */
.restore-note {
  @apply m-0 flex min-w-0 items-start gap-1.5;

  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.restore-note.is-pending {
  color: var(--warning);
}
.restore-note.is-blocked {
  color: var(--destructive);
}

/* 模式：默认停在“新增”，选中的那张带勾。 */
.restore-modes {
  @apply grid gap-2;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}
.restore-mode {
  @apply grid gap-1 px-3 py-2 text-left;

  background: var(--surface-acrylic-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
.restore-mode:hover:not(:disabled) {
  background: var(--surface-hover);
}
.restore-mode.is-active {
  border-color: var(--primary-solid);
  box-shadow: inset 0 0 0 1px var(--primary-solid);
}
.restore-mode:disabled {
  @apply cursor-not-allowed opacity-50;
}
.restore-mode-head {
  @apply flex items-center gap-1.5;
}
.restore-mode-head strong {
  @apply mr-auto font-medium;
}
.restore-mode.is-active .restore-mode-head {
  color: var(--primary-solid);
}
.restore-mode-detail {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.4;
}

/* 应用数据分组：只是个分组头，批量按钮仍是作者显式选择。 */
.restore-group {
  @apply flex min-w-0 items-center gap-2 px-3 py-2;

  background: var(--surface-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  font-size: var(--ui-caption-size);
}
.restore-group-note {
  @apply mr-auto truncate;

  color: var(--muted-foreground);
}
.restore-group-actions {
  @apply flex shrink-0 gap-1;
}

/* 冲突项：一张卡一件事，决议是一组分段按钮。 */
.restore-list {
  max-height: 20rem;
}
.restore-conflicts {
  @apply grid gap-2;
}
.restore-conflict {
  @apply grid gap-2 p-3;

  background: var(--surface-acrylic-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
.restore-conflict-head,
.restore-conflict-foot {
  @apply flex min-w-0 items-center gap-2;
}
.restore-path {
  @apply mr-auto truncate font-medium;
}
.restore-delta {
  @apply flex shrink-0 items-center gap-1;

  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.restore-delta-label {
  opacity: 0.75;
}
.restore-delta-value {
  color: var(--foreground);
}
.restore-conflict-foot {
  @apply justify-between;
}
.restore-segment {
  @apply inline-flex overflow-hidden;

  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
.restore-segment-item {
  @apply px-2.5 py-0.5;

  background: var(--surface);
  font-size: var(--ui-caption-size);
}
.restore-segment-item + .restore-segment-item {
  border-inline-start: 1px solid var(--border);
}
.restore-segment-item:hover:not(.is-active) {
  background: var(--surface-hover);
}
.restore-segment-item.is-active {
  background: var(--primary-solid);
  color: var(--primary-solid-foreground);
}
.restore-diff {
  height: 18rem;
}

/* 回执：字段对字段地说，不写成一段话。 */
.restore-receipt {
  padding: 12px;

  background: var(--surface-acrylic-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
}
.restore-facts {
  @apply grid gap-x-3 gap-y-1;
  grid-template-columns: max-content minmax(0, 1fr);
}
.restore-facts > div {
  @apply contents;
}
.restore-facts dt {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.restore-facts dd {
  @apply m-0 min-w-0;

  overflow-wrap: anywhere;
}
footer {
  @apply flex justify-end gap-2 pt-1;
}
</style>
