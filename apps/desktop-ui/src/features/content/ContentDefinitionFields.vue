<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { WORKSPACE_ROLES, type TemplateField } from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppCombobox } from '@/components/AppCombobox';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { AppTooltip } from '@/components/AppTooltip';
import { useLibraryStore } from '@/features/library';
import { toErrorMessage } from '@/utils/desktop-api';

import { contentKindOptions, contentOptions } from './options';
import { useContentStore } from './store';

const props = defineProps<{
  kind: 'skill' | 'template';
  modelValue: string;
  readonly?: boolean;
  idLocked?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const content = useContentStore();
const library = useLibraryStore();
const error = ref('');
const parsed = computed(() => parseDocumentFrontmatter(props.modelValue));
const header = computed(() => (parsed.value.status === 'ok' ? parsed.value.frontmatter : null));
const appliesTo = computed(() =>
  Array.isArray(header.value?.appliesTo)
    ? header.value.appliesTo.filter((value): value is string => typeof value === 'string')
    : []
);
const personas = computed(() => contentOptions('persona', content.entries, appliesTo.value));
const fields = computed(() => {
  const value = header.value?.fields;
  return Array.isArray(value) &&
    value.every(field => field && typeof field === 'object' && typeof field.key === 'string')
    ? (value as TemplateField[])
    : null;
});
const kinds = computed(() =>
  contentKindOptions(content.entries, library.available, [
    text(header.value?.targetKind),
    ...(fields.value ?? []).map(field => field.targetKind ?? '')
  ])
);
const roleNames = {
  manuscript: '正文',
  outline: '大纲',
  world: '设定',
  characters: '角色',
  threads: '伏笔',
  drafts: '草稿',
  inspiration: '灵感',
  templates: '模板'
};
const fieldTypes = [
  { value: 'text', label: '短文本' },
  { value: 'textarea', label: '长文本' },
  { value: 'select', label: '选项' },
  { value: 'tags', label: '多值' },
  { value: 'number', label: '数字' },
  { value: 'date', label: '日期' },
  { value: 'link', label: '资料链接' },
  { value: 'relations', label: '关系' },
  { value: 'checkbox', label: '勾选' }
];
onMounted(() => {
  if (props.kind === 'template') void library.load();
});
function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}
function patch(values: Record<string, unknown>) {
  if (props.readonly) return;
  try {
    emit('update:modelValue', patchDocumentFields(props.modelValue, values));
    error.value = '';
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
function togglePersona(id: string, selected: boolean) {
  patch({
    appliesTo: selected ? [...new Set([...appliesTo.value, id])] : appliesTo.value.filter(value => value !== id)
  });
}
function patchField(index: number, values: Partial<TemplateField>) {
  if (!fields.value) return;
  const next = [...fields.value];
  const field = { ...next[index], ...values } as TemplateField;
  if (values.type && values.type !== next[index]?.type) {
    delete field.default;
    if (values.type !== 'select') delete field.options;
    if (!['link', 'tags', 'relations'].includes(values.type)) delete field.targetKind;
  }
  next[index] = field;
  patch({ fields: next });
}
function addField() {
  if (!fields.value || fields.value.length >= 40) return;
  let index = fields.value.length + 1;
  while (fields.value.some(field => field.key === `field${index}`)) index += 1;
  patch({ fields: [...fields.value, { key: `field${index}`, label: '新字段', type: 'text' }] });
}
</script>
<template>
  <div class="definition-fields">
    <p v-if="!header" role="alert">元数据格式无效</p>
    <template v-else>
      <label
        >标识<AppInput
          :model-value="text(header[kind === 'skill' ? 'name' : 'template'])"
          :aria-label="kind === 'skill' ? '技能标识' : '模板标识'"
          :readonly="readonly || idLocked"
          :maxlength="kind === 'skill' ? 64 : 80"
          @update:model-value="patch({ [kind === 'skill' ? 'name' : 'template']: $event })"
      /></label>
      <template v-if="kind === 'skill'">
        <label
          >名称与描述<AppInput
            :model-value="text(header.description)"
            aria-label="技能描述"
            :readonly="readonly"
            maxlength="1000"
            @update:model-value="patch({ description: $event })"
        /></label>
        <fieldset>
          <legend>
            适用专员 <span>{{ appliesTo.length ? `${appliesTo.length} 位专员` : '全部专员' }}</span>
          </legend>
          <label v-for="persona in personas" :key="persona.value" class="inline">
            <AppCheckbox
              :model-value="appliesTo.includes(persona.value)"
              :disabled="readonly"
              :aria-label="`适用 ${persona.label}`"
              @update:model-value="togglePersona(persona.value, $event === true)"
            />
            <span
              >{{ persona.label }}<small>{{ persona.detail }}</small></span
            >
          </label>
        </fieldset>
      </template>
      <template v-else>
        <label
          >名称<AppInput
            :model-value="text(header.name)"
            aria-label="模板名称"
            :readonly="readonly"
            maxlength="100"
            @update:model-value="patch({ name: $event })"
        /></label>
        <div class="definition-pair">
          <label
            >资料类型<AppCombobox
              :model-value="text(header.targetKind)"
              aria-label="模板资料类型"
              :options="kinds"
              :disabled="readonly"
              @update:model-value="patch({ targetKind: $event })"
          /></label>
          <label
            >存放目录<AppSelect
              :model-value="text(header.targetRole)"
              aria-label="模板存放目录"
              :disabled="readonly"
              @update:model-value="patch({ targetRole: $event })"
            >
              <AppSelectItem v-for="role in WORKSPACE_ROLES" :key="role" :value="role">{{
                roleNames[role]
              }}</AppSelectItem>
            </AppSelect></label
          >
        </div>
        <p v-if="library.error" role="status">{{ library.error }}</p>
        <p v-if="!fields" role="alert">模板字段格式无效</p>
        <template v-else>
          <div v-for="(field, index) in fields" :key="index" class="definition-field">
            <div class="definition-field-heading">
              <strong>字段 {{ index + 1 }}</strong>
              <AppTooltip text="删除字段">
                <AppButton
                  icon
                  variant="ghost"
                  :aria-label="`删除字段 ${index + 1}`"
                  :disabled="readonly || fields.length <= 1"
                  @click="patch({ fields: fields.filter((_, at) => at !== index) })"
                >
                  <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
                </AppButton>
              </AppTooltip>
            </div>
            <div class="definition-pair">
              <label
                >标识<AppInput
                  :model-value="field.key"
                  :aria-label="`字段 ${index + 1} 标识`"
                  :readonly="readonly"
                  maxlength="64"
                  @update:model-value="patchField(index, { key: $event })"
              /></label>
              <label
                >名称<AppInput
                  :model-value="text(field.label)"
                  :aria-label="`字段 ${index + 1} 名称`"
                  :readonly="readonly"
                  maxlength="100"
                  @update:model-value="patchField(index, { label: $event })"
              /></label>
              <label
                >类型<AppSelect
                  :model-value="text(field.type)"
                  :aria-label="`字段 ${index + 1} 类型`"
                  :disabled="readonly"
                  @update:model-value="patchField(index, { type: $event as TemplateField['type'] })"
                >
                  <AppSelectItem v-for="type in fieldTypes" :key="type.value" :value="type.value">{{
                    type.label
                  }}</AppSelectItem>
                </AppSelect></label
              >
              <label class="inline"
                ><AppCheckbox
                  :model-value="field.required === true"
                  :disabled="readonly"
                  @update:model-value="patchField(index, { required: $event === true })"
                />必填</label
              >
            </div>
            <label v-if="['link', 'tags', 'relations'].includes(field.type)"
              >关联资料类型<AppCombobox
                :model-value="text(field.targetKind)"
                :aria-label="`字段 ${index + 1} 关联类型`"
                :options="kinds"
                :disabled="readonly"
                @update:model-value="patchField(index, { targetKind: $event })"
            /></label>
            <label v-if="field.type === 'select'"
              >选项<AppTextarea
                :model-value="(Array.isArray(field.options) ? field.options : []).join('\n')"
                :aria-label="`字段 ${index + 1} 选项`"
                :readonly="readonly"
                :rows="3"
                @update:model-value="patchField(index, { options: $event.split(/\r?\n/) })"
            /></label>
          </div>
          <AppButton :disabled="readonly || fields.length >= 40" @click="addField"
            ><span class="i-mingcute-add-line size-4" aria-hidden="true" />添加字段</AppButton
          >
        </template>
      </template>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped lang="scss">
.definition-fields {
  @apply grid min-w-0 gap-3;
  font-size: var(--ui-font-size);
}
label {
  @apply flex min-w-0 flex-col gap-1.5;
}
.inline {
  @apply flex-row items-center gap-2;
}
.inline span {
  @apply flex min-w-0 flex-col gap-1;
  overflow-wrap: anywhere;
}
small,
legend span {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
fieldset {
  @apply m-0 grid gap-3 border-0 border-t p-0 pt-3;
  border-color: var(--border-subtle);
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
legend {
  @apply pb-2 font-medium;
}
.definition-pair {
  @apply grid min-w-0 grid-cols-2 gap-3;
}
.definition-field {
  @apply grid min-w-0 gap-3 border-t pt-3;
  border-color: var(--border-subtle);
}
.definition-field-heading {
  @apply flex items-center justify-between gap-2;
}
.definition-field-heading strong {
  @apply font-medium;
}
p {
  @apply m-0;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
