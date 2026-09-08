<script setup lang="ts">
import { useId } from 'vue';

import type { AssetFieldValue, AssetRecord, TemplateField } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppCombobox } from '@/components/AppCombobox';
import { AppInput } from '@/components/AppInput';
import { AppNumberInput } from '@/components/AppNumberInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
const props = defineProps<{
  fields: TemplateField[];
  values: Record<string, unknown>;
  assets?: AssetRecord[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ field: [key: string, value: AssetFieldValue] }>();
const id = useId();
type Relation = { to: string; type: string; note?: string };
const relationRows = (key: string) => (Array.isArray(props.values[key]) ? props.values[key] : []) as Relation[];
function relation(key: string, index: number, patch: Partial<Relation>) {
  const rows = [...relationRows(key)];
  rows[index] = { ...rows[index]!, ...patch };
  emit('field', key, rows);
}
function text(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function tags(value: unknown) {
  return Array.isArray(value) ? value.join('\n') : text(value);
}
const choices = (field: TemplateField) =>
  (props.assets ?? [])
    .filter(
      asset =>
        !field.targetKind ||
        asset.kind === field.targetKind ||
        (field.targetKind === 'chapter' && asset.role === 'manuscript' && !asset.kind)
    )
    .slice(0, 200);
const linkOptions = (field: TemplateField) =>
  choices(field).map(asset => ({
    value: `[[${asset.sourcePath}]]`,
    label: asset.title,
    description: asset.sourcePath
  }));
const relationOptions = () =>
  (props.assets ?? []).slice(0, 200).map(asset => ({
    value: `[[${asset.sourcePath}]]`,
    label: asset.title,
    description: asset.sourcePath
  }));
function addLink(key: string, value: string) {
  if (value !== '__add')
    emit('field', key, [...new Set([...tags(props.values[key]).split('\n').filter(Boolean), value])]);
}
</script>
<template>
  <fieldset class="template-fields" :disabled="disabled">
    <div
      v-for="field in fields"
      :key="field.key"
      class="template-field"
      :class="{ wide: ['textarea', 'tags', 'relations'].includes(field.type) }"
    >
      <label :for="`${id}-${field.key}`"
        >{{ field.label }}<span v-if="field.required" aria-hidden="true"> *</span></label
      >
      <AppCheckbox
        v-if="field.type === 'checkbox'"
        :id="`${id}-${field.key}`"
        :model-value="values[field.key] === true"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event === true)"
      />
      <AppTextarea
        v-else-if="field.type === 'textarea'"
        :id="`${id}-${field.key}`"
        :model-value="text(values[field.key])"
        :rows="3"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event)"
      />
      <template v-else-if="field.type === 'tags'">
        <AppTextarea
          :id="`${id}-${field.key}`"
          :model-value="tags(values[field.key])"
          :rows="2"
          :disabled="disabled"
          @update:model-value="emit('field', field.key, $event.split(/\r?\n/))"
        />
        <AppSelect
          v-if="field.targetKind"
          model-value="__add"
          :aria-label="`添加${field.label}`"
          :disabled="disabled"
          @update:model-value="addLink(field.key, $event)"
        >
          <AppSelectItem value="__add" disabled>添加{{ field.label }}</AppSelectItem>
          <AppSelectItem v-for="asset in choices(field)" :key="asset.sourcePath" :value="`[[${asset.sourcePath}]]`">
            {{ asset.title }} · {{ asset.sourcePath }}
          </AppSelectItem>
        </AppSelect>
      </template>
      <div v-else-if="field.type === 'relations'" class="relations">
        <div v-for="(row, index) in relationRows(field.key)" :key="index" class="relation-row">
          <template v-if="row && typeof row.to === 'string' && typeof row.type === 'string'">
            <AppCombobox
              :model-value="row.to"
              :aria-label="`${field.label} ${index + 1} 目标`"
              :options="relationOptions()"
              :disabled="disabled"
              @update:model-value="relation(field.key, index, { to: $event })"
            />
            <AppInput
              :model-value="row.type"
              :aria-label="`${field.label} ${index + 1} 类型`"
              :disabled="disabled"
              @update:model-value="relation(field.key, index, { type: $event })"
            />
            <AppInput
              :model-value="row.note ?? ''"
              :aria-label="`${field.label} ${index + 1} 备注`"
              :disabled="disabled"
              @update:model-value="relation(field.key, index, { note: $event })"
            />
          </template>
          <p v-else class="relation-invalid" role="status">第 {{ index + 1 }} 项关系格式无效，可移除或在源文件中修正</p>
          <AppButton
            icon
            size="xs"
            variant="ghost"
            :aria-label="`移除${field.label} ${index + 1}`"
            title="移除关系"
            @click="
              emit(
                'field',
                field.key,
                relationRows(field.key).filter((_, at) => at !== index)
              )
            "
            ><span class="i-mingcute-delete-2-line size-3.5"
          /></AppButton>
        </div>
        <AppButton
          icon
          size="xs"
          variant="ghost"
          :aria-label="`添加${field.label}`"
          title="添加关系"
          @click="emit('field', field.key, [...relationRows(field.key), { to: '', type: '', note: '' }])"
          ><span class="i-mingcute-add-line size-3.5"
        /></AppButton>
      </div>
      <AppNumberInput
        v-else-if="field.type === 'number'"
        :id="`${id}-${field.key}`"
        :model-value="typeof values[field.key] === 'number' ? (values[field.key] as number) : undefined"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event ?? null)"
      />
      <AppCombobox
        v-else-if="field.type === 'link'"
        :id="`${id}-${field.key}`"
        :model-value="text(values[field.key])"
        :options="linkOptions(field)"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event)"
      />
      <AppSelect
        v-else-if="field.type === 'select'"
        :id="`${id}-${field.key}`"
        :model-value="text(values[field.key]) || '__unset'"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event === '__unset' ? '' : $event)"
      >
        <AppSelectItem value="__unset">未设置</AppSelectItem>
        <AppSelectItem
          v-if="text(values[field.key]) && !field.options?.includes(text(values[field.key]))"
          :value="text(values[field.key])"
          >{{ text(values[field.key]) }}</AppSelectItem
        >
        <AppSelectItem v-for="option in (field.options ?? []).filter(Boolean)" :key="option" :value="option">{{
          option
        }}</AppSelectItem>
      </AppSelect>
      <AppInput
        v-else
        :id="`${id}-${field.key}`"
        :model-value="text(values[field.key])"
        :type="field.type === 'date' ? 'date' : 'text'"
        :disabled="disabled"
        @update:model-value="emit('field', field.key, $event)"
      />
    </div>
  </fieldset>
</template>
<style scoped lang="scss">
.template-fields {
  @apply m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0;
}
.template-field {
  @apply flex min-w-0 flex-col gap-1.5;
  font-size: var(--ui-font-size);
}
.template-field.wide {
  grid-column: 1 / -1;
}
label {
  @apply min-w-0;
  overflow-wrap: anywhere;
}
.relations {
  @apply flex min-w-0 flex-col gap-2;
}
.relation-row {
  @apply grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-1;
}
.relation-invalid {
  @apply m-0;
  grid-column: 1 / -2;
  color: var(--warning);
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .template-fields {
    @apply grid-cols-1;
  }
  .relation-row {
    @apply grid-cols-[minmax(0,1fr)_auto];
  }
}
</style>
