<script setup lang="ts">
import { useId } from 'vue';

import type { AssetFieldValue, AssetRecord, TemplateField } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
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
const inputValue = (event: Event) => (event.target as HTMLInputElement).value;
const choices = (field: TemplateField) =>
  (props.assets ?? [])
    .filter(
      asset =>
        !field.targetKind ||
        asset.kind === field.targetKind ||
        (field.targetKind === 'chapter' && asset.role === 'manuscript' && !asset.kind)
    )
    .slice(0, 200);
function addLink(key: string, event: Event) {
  const select = event.target as HTMLSelectElement;
  if (select.value)
    emit('field', key, [...new Set([...tags(props.values[key]).split('\n').filter(Boolean), select.value])]);
  select.value = '';
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
      <input
        v-if="field.type === 'checkbox'"
        :id="`${id}-${field.key}`"
        type="checkbox"
        :checked="values[field.key] === true"
        @change="emit('field', field.key, ($event.target as HTMLInputElement).checked)"
      />
      <textarea
        v-else-if="field.type === 'textarea'"
        :id="`${id}-${field.key}`"
        :value="text(values[field.key])"
        rows="3"
        @input="emit('field', field.key, inputValue($event))"
      />
      <template v-else-if="field.type === 'tags'">
        <textarea
          :id="`${id}-${field.key}`"
          :value="tags(values[field.key])"
          rows="2"
          @input="emit('field', field.key, inputValue($event).split(/\r?\n/))"
        />
        <select v-if="field.targetKind" :aria-label="`添加${field.label}`" @change="addLink(field.key, $event)">
          <option value="">添加{{ field.label }}</option>
          <option v-for="asset in choices(field)" :key="asset.sourcePath" :value="`[[${asset.sourcePath}]]`">
            {{ asset.title }} · {{ asset.sourcePath }}
          </option>
        </select>
      </template>
      <div v-else-if="field.type === 'relations'" class="relations">
        <div v-for="(row, index) in relationRows(field.key)" :key="index" class="relation-row">
          <input
            :value="row.to"
            :aria-label="`${field.label} ${index + 1} 目标`"
            :list="`${id}-links`"
            @input="relation(field.key, index, { to: inputValue($event) })"
          />
          <input
            :value="row.type"
            :aria-label="`${field.label} ${index + 1} 类型`"
            @input="relation(field.key, index, { type: inputValue($event) })"
          />
          <input
            :value="row.note ?? ''"
            :aria-label="`${field.label} ${index + 1} 备注`"
            @input="relation(field.key, index, { note: inputValue($event) })"
          />
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
      <input
        v-else
        :id="`${id}-${field.key}`"
        :value="text(values[field.key])"
        :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'"
        :list="field.type === 'select' || field.type === 'link' ? `${id}-${field.key}-choices` : undefined"
        @input="
          emit(
            'field',
            field.key,
            field.type === 'number'
              ? inputValue($event) === ''
                ? null
                : Number(inputValue($event))
              : inputValue($event)
          )
        "
      />
      <datalist v-if="field.type === 'select' || field.type === 'link'" :id="`${id}-${field.key}-choices`">
        <option v-for="option in field.options ?? []" :key="option" :value="option" />
        <option
          v-for="asset in field.type === 'link' ? choices(field) : []"
          :key="asset.sourcePath"
          :value="`[[${asset.sourcePath}]]`"
        >
          {{ asset.title }}
        </option>
      </datalist>
    </div>
    <datalist :id="`${id}-links`">
      <option v-for="asset in (assets ?? []).slice(0, 200)" :key="asset.sourcePath" :value="`[[${asset.sourcePath}]]`">
        {{ asset.title }}
      </option>
    </datalist>
  </fieldset>
</template>
<style scoped lang="scss">
.template-fields {
  @apply m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0;
}
.template-field {
  @apply flex min-w-0 flex-col gap-1.5 text-xs;
}
.template-field.wide {
  grid-column: 1 / -1;
}
label {
  @apply min-w-0;
  overflow-wrap: anywhere;
}
input:not([type='checkbox']),
select,
textarea {
  @apply w-full min-w-0 rounded border px-2 py-1.5 text-xs;
  border-color: var(--border-subtle);
  background: var(--input-background);
  color: var(--foreground);
}
textarea {
  @apply resize-y;
  min-height: 48px;
}
input[type='checkbox'] {
  @apply h-4 w-4;
}
.relations {
  @apply flex min-w-0 flex-col gap-2;
}
.relation-row {
  @apply grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-1;
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
