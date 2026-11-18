<script setup lang="ts">
import { ref } from 'vue';

import type { ManagedSkillView, SkillScope } from '@chaptale/agent-host/protocol';

import { AppBadge } from '@/components/AppBadge';
import { AppButton } from '@/components/AppButton';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSwitch } from '@/components/AppSwitch';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';
import { SettingsList, SettingsListRow, SettingsToggleField } from '@/features/settings';

const props = defineProps<{
  scope: SkillScope;
  title: string;
  hint: string;
  dirPath: string | null;
  skills: ManagedSkillView[];
  busy: boolean;
  canSelectSource: boolean;
  canRevealPath: boolean;
}>();

const emit = defineEmits<{
  toggleEnabled: [skill: ManagedSkillView, enabled: boolean];
  create: [payload: { scope: SkillScope; name: string; description: string; disableModelInvocation: boolean }];
  importSource: [scope: SkillScope, kind: 'directory' | 'file'];
  revealPath: [filePath: string];
  requestRemove: [skill: ManagedSkillView];
}>();

const creating = ref(false);
const draftName = ref('');
const draftDescription = ref('');
const draftManualOnly = ref(false);

function startCreate() {
  draftName.value = '';
  draftDescription.value = '';
  draftManualOnly.value = false;
  creating.value = true;
}

function cancelCreate() {
  creating.value = false;
}

function submitCreate() {
  const name = draftName.value.trim();
  const description = draftDescription.value.trim();
  if (!name || !description || props.busy) return;
  emit('create', {
    scope: props.scope,
    name,
    description,
    disableModelInvocation: draftManualOnly.value
  });
  creating.value = false;
}
</script>

<template>
  <section class="skill-group">
    <header class="skill-group-header">
      <div class="skill-group-heading">
        <h4 class="skill-group-title">{{ title }}</h4>
        <p class="skill-group-hint">{{ hint }}</p>
      </div>
      <div class="skill-group-actions">
        <AppDropdownMenu align="end" content-size="sm">
          <template #trigger>
            <AppButton type="button" size="sm" variant="outline" :disabled="busy">
              <span class="i-mingcute-add-line size-4" aria-hidden="true" />添加
            </AppButton>
          </template>
          <AppDropdownMenuItem density="sm" @select="startCreate">新建技能</AppDropdownMenuItem>
          <AppDropdownMenuItem v-if="canSelectSource" density="sm" @select="emit('importSource', scope, 'directory')">
            导入文件夹…
          </AppDropdownMenuItem>
          <AppDropdownMenuItem v-if="canSelectSource" density="sm" @select="emit('importSource', scope, 'file')">
            导入 .md 文件…
          </AppDropdownMenuItem>
        </AppDropdownMenu>
        <AppTooltip v-if="canRevealPath && dirPath" text="打开目录">
          <AppButton
            type="button"
            icon
            size="sm"
            variant="ghost"
            :disabled="busy"
            :aria-label="`打开${title}的目录`"
            @click="emit('revealPath', dirPath)"
          >
            <span class="i-mingcute-folder-open-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </div>
    </header>

    <AppForm v-if="creating" class="skill-create-bar" :disabled="busy" @submit="submitCreate">
      <div class="skill-create-fields">
        <label class="skill-field">
          <span>技能标识</span>
          <AppInput
            v-model="draftName"
            aria-label="技能标识"
            placeholder="小写字母、数字与连字符，如 dialogue-polish"
          />
        </label>
        <label class="skill-field">
          <span>用途说明</span>
          <AppTextarea
            v-model="draftDescription"
            aria-label="用途说明"
            :rows="3"
            resize="vertical"
            placeholder="写清这项技能做什么、何时调用，如：润色古风对白与称谓时使用"
          />
        </label>
      </div>
      <SettingsToggleField
        v-model="draftManualOnly"
        title="仅手动调用"
        description="只在输入框输入 /skill:名称 时展开，不自动写入系统提示词索引。"
      />
      <div class="skill-create-actions">
        <AppButton type="button" size="sm" variant="ghost" @click="cancelCreate">取消</AppButton>
        <AppButton
          type="submit"
          size="sm"
          variant="primary"
          :disabled="busy || !draftName.trim() || !draftDescription.trim()"
        >
          创建
        </AppButton>
      </div>
    </AppForm>

    <AppEmptyState
      v-if="!skills.length && !creating"
      :title="scope === 'work' ? '当前作品还没有专属技能' : '还没有全局技能'"
      description="从“添加”新建一项，或导入已有的 SKILL.md。"
    />

    <SettingsList v-else-if="skills.length">
      <SettingsListRow
        v-for="skill in skills"
        :key="`${skill.scope}:${skill.filePath}`"
        :title="skill.name"
        :muted="!skill.enabled || skill.overriddenByWork"
      >
        <template #badges>
          <AppBadge v-if="skill.disableModelInvocation">仅手动</AppBadge>
          <AppBadge v-if="skill.overriddenByWork">已被当前作品接管</AppBadge>
        </template>
        <span class="skill-description">{{ skill.description }}</span>
        <template #actions>
          <AppTooltip v-if="canRevealPath" text="定位文件">
            <AppButton
              type="button"
              icon
              size="sm"
              variant="ghost"
              :disabled="busy"
              :aria-label="`定位技能 ${skill.name} 的文件`"
              @click="emit('revealPath', skill.filePath)"
            >
              <span class="i-mingcute-file-search-line size-4" aria-hidden="true" />
            </AppButton>
          </AppTooltip>
          <AppTooltip text="移除">
            <AppButton
              type="button"
              icon
              size="sm"
              variant="ghost"
              :disabled="busy"
              :aria-label="`移除技能 ${skill.name}`"
              @click="emit('requestRemove', skill)"
            >
              <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
            </AppButton>
          </AppTooltip>
        </template>
        <template #trailing>
          <AppSwitch
            class="skill-switch"
            :model-value="skill.enabled"
            :disabled="busy"
            :aria-label="`启用技能 ${skill.name}`"
            @update:model-value="emit('toggleEnabled', skill, $event)"
          />
        </template>
      </SettingsListRow>
    </SettingsList>
  </section>
</template>

<style scoped lang="scss">
.skill-group {
  @apply flex flex-col gap-2.5;
}

.skill-group-header {
  @apply flex flex-wrap items-start justify-between gap-3;
}

.skill-group-heading {
  @apply flex min-w-0 flex-col gap-0.5;
}

.skill-group-title {
  @apply m-0 font-semibold;
  font-size: var(--ui-font-size);
  overflow-wrap: anywhere;
}

.skill-group-hint {
  @apply m-0 text-xs leading-5;
  color: var(--muted-foreground);
}

.skill-group-actions {
  @apply flex flex-wrap items-center gap-1.5;
}

.skill-create-bar {
  @apply flex flex-col gap-3 border p-3;
  background: var(--surface);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.skill-create-fields {
  @apply flex flex-col gap-3;
}

.skill-description {
  white-space: pre-line;
}

.skill-field {
  @apply flex min-w-0 flex-col gap-1.5 text-xs font-medium;
  color: var(--foreground);
}

.skill-create-actions {
  @apply flex items-center justify-end gap-2;
}

.skill-switch {
  @apply ml-2;
}
</style>
