<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui';
import { computed } from 'vue';

import type { CloudRestoreChoice } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDiffView } from '@/components/AppDiffView';

import { formatSize } from '../presentation';
import { useCloudSyncStore } from '../store';
import type { RestoreWizardState } from '../store/types';

const props = defineProps<{ wizard: RestoreWizardState }>();
const cloud = useCloudSyncStore();
const conflicts = computed(() =>
  props.wizard.plan.entries
    .filter(entry => entry.verdict === 'conflict')
    .toSorted((a, b) => Number(a.system) - Number(b.system))
);
const systemPaths = computed(() => conflicts.value.filter(entry => entry.system).map(entry => entry.relativePath));
const choices: { value: CloudRestoreChoice; label: string }[] = [
  { value: 'archive', label: '用归档' },
  { value: 'local', label: '用本地' },
  { value: 'both', label: '两个都留' }
];
</script>

<template>
  <section v-if="conflicts.length" class="restore-block">
    <h4 class="restore-heading">
      两边不同的文件 <span class="restore-count">{{ conflicts.length }}</span>
    </h4>
    <div v-if="systemPaths.length" class="restore-group">
      <span class="i-mingcute-folder-line size-4 shrink-0" aria-hidden="true" />
      <strong>应用数据</strong><span class="restore-group-note">.chaptale/ · {{ systemPaths.length }} 项</span>
      <div class="restore-group-actions">
        <AppButton
          variant="ghost"
          size="xs"
          :disabled="cloud.isApplying"
          @click="cloud.setRestoreChoices(systemPaths, 'local')"
          >统一用本地</AppButton
        >
        <AppButton
          variant="ghost"
          size="xs"
          :disabled="cloud.isApplying"
          @click="cloud.setRestoreChoices(systemPaths, 'archive')"
          >统一用归档</AppButton
        >
      </div>
    </div>
    <ul class="restore-conflicts">
      <li v-for="entry in conflicts" :key="entry.relativePath" class="restore-conflict">
        <div class="restore-conflict-head">
          <span
            :class="entry.system ? 'i-mingcute-folder-line' : 'i-mingcute-file-line'"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="restore-path">{{ entry.relativePath }}</span>
          <span class="restore-delta">
            <span class="restore-delta-label">归档</span
            ><span class="restore-delta-value">{{ formatSize(entry.archiveBytes) }}</span>
            <span class="i-mingcute-arrow-right-line size-3 shrink-0" aria-hidden="true" />
            <span class="restore-delta-label">本地</span
            ><span class="restore-delta-value">{{ formatSize(entry.localBytes ?? 0) }}</span>
          </span>
        </div>
        <div class="restore-conflict-foot">
          <RadioGroupRoot
            class="restore-segment"
            :aria-label="`${entry.relativePath} 用哪一份`"
            :model-value="wizard.choices[entry.relativePath]"
            :disabled="cloud.isApplying"
            @update:model-value="cloud.setRestoreChoice(entry.relativePath, $event as CloudRestoreChoice)"
          >
            <RadioGroupItem
              v-for="option in choices"
              :key="option.value"
              :value="option.value"
              class="restore-segment-item"
              :class="{ 'is-active': wizard.choices[entry.relativePath] === option.value }"
            >
              {{ option.label }}
            </RadioGroupItem>
          </RadioGroupRoot>
          <AppButton
            variant="ghost"
            size="xs"
            :disabled="cloud.isApplying"
            :aria-expanded="wizard.diff?.relativePath === entry.relativePath"
            @click="cloud.loadRestoreDiff(entry.relativePath)"
          >
            <span class="i-mingcute-git-compare-line size-4" aria-hidden="true" />
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
            {{ wizard.diff.reason === 'binary' ? '非文本文件，无法在应用内对比' : '文件过大，无法在应用内对比' }}
          </p>
        </div>
      </li>
    </ul>
    <p v-if="cloud.pendingConflicts.length" class="restore-note is-pending" role="status">
      <span class="i-mingcute-time-line size-4 shrink-0" aria-hidden="true" />
      还有 {{ cloud.pendingConflicts.length }} 项没决定，它们不会被写入，本地保持不动
    </p>
  </section>
</template>
