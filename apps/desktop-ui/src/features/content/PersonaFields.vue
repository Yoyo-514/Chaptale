<script setup lang="ts">
import { computed } from 'vue';

import { CONTENT_MEMORY_DOMAINS, CONTENT_TOOLS, type PersonaFrontmatter } from '@chaptale/shared';

import { AppCheckbox } from '@/components/AppCheckbox';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useSettingsStore } from '@/features/settings';

import { useContentStore } from './store';

const props = defineProps<{ modelValue: PersonaFrontmatter; readonly?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: PersonaFrontmatter] }>();
const content = useContentStore();
const settings = useSettingsStore();
const review = computed(() => props.modelValue.type === 'review');
const skills = computed(() =>
  [
    ...new Set([
      ...content.entries.filter(item => item.kind === 'skill' && item.effective).map(item => item.id),
      ...(props.modelValue.skills ?? [])
    ])
  ].toSorted()
);
function patch(value: Partial<PersonaFrontmatter>) {
  emit('update:modelValue', { ...props.modelValue, ...value });
}
function toggle(values: readonly string[] | undefined, id: string, enabled: boolean) {
  return enabled ? [...new Set([...(values ?? []), id])] : (values ?? []).filter(value => value !== id);
}
function setRole(value: string) {
  const next = {
    ...props.modelValue,
    type: value === 'review' ? ('review' as const) : ('custom' as const),
    execution: value === 'review' ? ('task' as const) : ('chat' as const),
    tools: [],
    delegatable: false
  };
  if (value === 'review') {
    next.output = 'custom-issues';
    next.memory = { read: [], write: [], propose: [] };
  } else delete next.output;
  emit('update:modelValue', next);
}
</script>
<template>
  <div class="persona-fields">
    <label
      >名称<AppInput
        :model-value="modelValue.name"
        :readonly="readonly"
        maxlength="64"
        @update:model-value="patch({ name: $event })"
    /></label>
    <label
      >职责<AppSelect :model-value="review ? 'review' : 'chat'" :disabled="readonly" @update:model-value="setRole">
        <AppSelectItem value="chat">对话与构思</AppSelectItem><AppSelectItem value="review">独立审查</AppSelectItem>
      </AppSelect></label
    >
    <label class="inline"
      ><AppCheckbox
        :model-value="modelValue.enabled !== false"
        :disabled="readonly"
        @update:model-value="patch({ enabled: $event === true })"
      />启用</label
    >
    <label v-if="modelValue.execution === 'task'" class="inline"
      ><AppCheckbox
        :model-value="modelValue.delegatable === true"
        :disabled="readonly"
        @update:model-value="patch({ delegatable: $event === true })"
      />允许 Agent 委派</label
    >
    <label
      >模型偏好<AppSelect
        :model-value="modelValue.model?.preference ?? '__default'"
        :disabled="readonly"
        @update:model-value="patch({ model: $event === '__default' ? undefined : { preference: $event } })"
      >
        <AppSelectItem value="__default">使用默认模型</AppSelectItem>
        <AppSelectItem
          v-for="model in settings.models?.models.filter(item => item.authConfigured)"
          :key="`${model.provider}/${model.id}`"
          :value="`${model.provider}/${model.id}`"
          >{{ model.providerName }} / {{ model.name }}</AppSelectItem
        >
        <AppSelectItem
          v-if="
            modelValue.model?.preference &&
            !settings.models?.models.some(item => `${item.provider}/${item.id}` === modelValue.model?.preference)
          "
          :value="modelValue.model.preference"
          >{{ modelValue.model.preference }}</AppSelectItem
        >
      </AppSelect></label
    >
    <fieldset>
      <legend>可读资料</legend>
      <label
        v-for="domain in CONTENT_MEMORY_DOMAINS.filter(item => !review || item.id !== 'notes')"
        :key="domain.id"
        class="inline"
      >
        <AppCheckbox
          :model-value="modelValue.memory?.read?.includes(domain.id) ?? false"
          :disabled="readonly"
          @update:model-value="
            patch({
              memory: { ...modelValue.memory, read: toggle(modelValue.memory?.read, domain.id, $event === true) }
            })
          "
        />{{ domain.label }}
      </label>
    </fieldset>
    <fieldset>
      <legend>工具授权</legend>
      <label
        v-for="tool in CONTENT_TOOLS.filter(item => !review || item.id === 'memory_search')"
        :key="tool.id"
        class="inline"
      >
        <AppCheckbox
          :model-value="modelValue.tools?.includes(tool.id) ?? false"
          :disabled="readonly"
          @update:model-value="patch({ tools: toggle(modelValue.tools, tool.id, $event === true) })"
        />{{ tool.label }}
      </label>
    </fieldset>
    <fieldset v-if="!review">
      <legend>记忆变更</legend>
      <label class="inline"
        ><AppCheckbox
          :model-value="modelValue.memory?.write?.includes('notes') ?? false"
          :disabled="readonly"
          @update:model-value="patch({ memory: { ...modelValue.memory, write: $event === true ? ['notes'] : [] } })"
        />允许保存待确认观察</label
      >
      <label class="inline"
        ><AppCheckbox
          :model-value="modelValue.memory?.propose?.includes('canon') ?? false"
          :disabled="readonly"
          @update:model-value="patch({ memory: { ...modelValue.memory, propose: $event === true ? ['canon'] : [] } })"
        />允许提出设定变更（需确认）</label
      >
    </fieldset>
    <fieldset>
      <legend>绑定技能</legend>
      <label v-for="skill in skills" :key="skill" class="inline">
        <AppCheckbox
          :model-value="modelValue.skills?.includes(skill) ?? false"
          :disabled="readonly"
          @update:model-value="patch({ skills: toggle(modelValue.skills, skill, $event === true) })"
        />{{ skill }}
      </label>
      <span v-if="!skills.length">暂无技能</span>
    </fieldset>
  </div>
</template>
<style scoped lang="scss">
.persona-fields {
  @apply grid gap-3;
}
label {
  @apply flex min-w-0 flex-col gap-1.5;
}
.inline {
  @apply flex-row items-center gap-2;
  overflow-wrap: anywhere;
}
fieldset {
  @apply m-0 grid gap-2 border-0 border-t p-0 pt-3;
  border-color: var(--border-subtle);
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
legend {
  @apply pb-1 pt-3 font-medium;
}
</style>
