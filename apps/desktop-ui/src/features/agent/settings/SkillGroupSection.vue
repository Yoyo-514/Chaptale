<script setup lang="ts">
import { ref } from 'vue';

import type { ManagedSkillView, SkillScope } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppForm } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppTextarea } from '@/components/AppTextarea';
import { SettingsToggleField } from '@/features/settings';

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
        <AppButton type="button" size="sm" variant="outline" :disabled="busy" @click="startCreate">新建技能</AppButton>
        <AppButton
          v-if="canSelectSource"
          type="button"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('importSource', scope, 'directory')"
        >
          导入文件夹
        </AppButton>
        <AppButton
          v-if="canSelectSource"
          type="button"
          size="sm"
          variant="outline"
          :disabled="busy"
          @click="emit('importSource', scope, 'file')"
        >
          导入 .md 文件
        </AppButton>
        <AppButton
          v-if="canRevealPath && dirPath"
          type="button"
          size="sm"
          variant="ghost"
          :disabled="busy"
          @click="emit('revealPath', dirPath)"
        >
          打开目录
        </AppButton>
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

    <div v-if="!skills.length && !creating" class="settings-empty-card">
      {{ scope === 'work' ? '当前作品还没有专属技能。' : '还没有添加全局技能。' }}
    </div>

    <ul v-else-if="skills.length" class="skill-list">
      <li
        v-for="skill in skills"
        :key="`${skill.scope}:${skill.filePath}`"
        class="skill-row"
        :class="{ 'is-muted': !skill.enabled || skill.overriddenByWork }"
      >
        <AppCheckbox
          class="skill-row-check"
          :model-value="skill.enabled"
          :disabled="busy"
          :aria-label="`启用技能 ${skill.name}`"
          @update:model-value="emit('toggleEnabled', skill, $event === true)"
        />
        <div class="settings-model-copy skill-row-copy">
          <div class="skill-row-title">
            <strong>{{ skill.name }}</strong>
            <span v-if="skill.disableModelInvocation" class="settings-dropdown-item-badge">仅手动</span>
            <span v-if="skill.overriddenByWork" class="settings-dropdown-item-badge">已被当前作品接管</span>
          </div>
          <span class="skill-description">{{ skill.description }}</span>
        </div>
        <div class="skill-row-actions">
          <AppButton
            v-if="canRevealPath"
            type="button"
            size="sm"
            variant="ghost"
            :disabled="busy"
            @click="emit('revealPath', skill.filePath)"
          >
            定位文件
          </AppButton>
          <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="emit('requestRemove', skill)">
            移除
          </AppButton>
        </div>
      </li>
    </ul>
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

.skill-list {
  @apply m-0 flex list-none flex-col divide-y border p-0;
  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.skill-row {
  @apply flex items-start gap-3 px-3.5 py-2.5;
  border-color: var(--border-subtle);
}

.skill-row.is-muted .skill-row-copy {
  opacity: 0.65;
}

.skill-row-check {
  @apply mt-0.5 shrink-0;
}

.skill-row-copy {
  @apply flex-1;
}

.skill-row-title {
  @apply flex flex-wrap items-center gap-2;
}

.skill-row-actions {
  @apply flex shrink-0 items-center gap-1;
}
</style>
