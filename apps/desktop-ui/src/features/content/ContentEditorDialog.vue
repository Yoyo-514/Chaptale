<script setup lang="ts">
import { computed, ref, toRaw, watch } from 'vue';

import type { ContentDocument, ContentKind, ContentScope, PersonaFrontmatter } from '@chaptale/shared';
import {
  parseDocumentFrontmatter,
  patchDocumentFields,
  replaceDocumentBody
} from '@chaptale/shared/document-frontmatter';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTabs } from '@/components/AppTabs';
import { AppTextarea } from '@/components/AppTextarea';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import ContentDefinitionFields from './ContentDefinitionFields.vue';
import PersonaFields from './PersonaFields.vue';
import { toContentRef, useContentStore } from './store';

const props = defineProps<{ open: boolean; kind: ContentKind; document: ContentDocument | null }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: []; remove: [document: ContentDocument] }>();
const content = useContentStore();
const id = ref('');
const scope = ref<ContentScope>('user');
const markdown = ref('');
const body = ref('');
const persona = ref<PersonaFrontmatter>({ id: '', name: '', type: 'custom', execution: 'chat' });
const tab = ref('body');
const error = ref('');
const busy = ref(false);
const copied = ref(false);
const discard = ref(false);
const archive = ref(false);
let context: { rootPath?: string } = {};
let baseline = '';
const readonly = computed(() => (props.document?.source === 'builtin' || props.document?.archived) && !copied.value);
const personaForm = computed(
  () => props.kind === 'persona' && (persona.value.execution === 'chat' || persona.value.type === 'review')
);
const labels = { persona: '专员', skill: '技能', template: '模板' };
const parsedMarkdown = computed(() => parseDocumentFrontmatter(markdown.value));
const serialized = computed(() => {
  if (!personaForm.value) return markdown.value;
  const header = { ...persona.value, id: id.value };
  if (header.model === undefined) delete header.model;
  return patchDocumentFields(body.value, header);
});
const dirty = computed(() => !readonly.value && serialized.value !== baseline);
watch(
  () => props.open,
  open => {
    if (!open) return;
    context = { ...content.context };
    copied.value = false;
    error.value = '';
    scope.value = props.document?.source === 'workspace' ? 'workspace' : 'user';
    id.value = props.document?.id ?? '';
    markdown.value =
      props.document?.markdown ??
      (props.kind === 'skill'
        ? '---\nname: my-skill\ndescription: 我的创作流程\nappliesTo: []\n---\n\n'
        : '---\ntemplate: my-template\nname: 我的模板\ntargetKind: note\ntargetRole: inspiration\nfields:\n  - key: title\n    label: 标题\n    type: text\n    required: true\n---\n\n# {{title}}\n\n');
    const parsed = parseDocumentFrontmatter(props.document?.markdown ?? '');
    persona.value = props.document?.persona
      ? structuredClone(toRaw(props.document.persona))
      : {
          id: '',
          name: '',
          type: 'custom',
          execution: 'chat',
          tools: [],
          skills: [],
          memory: { read: [], write: [], propose: [] },
          delegatable: false,
          enabled: true
        };
    body.value = parsed.status === 'ok' ? parsed.body : '';
    tab.value = props.document ? 'body' : 'settings';
    baseline = serialized.value;
  }
);
function requestClose() {
  if (busy.value) return;
  if (dirty.value) discard.value = true;
  else emit('update:open', false);
}
function copy() {
  copied.value = true;
  scope.value = 'user';
  id.value = `${id.value.slice(0, 55)}-copy`;
  if (!personaForm.value) {
    const field = props.kind === 'persona' ? 'id' : props.kind === 'skill' ? 'name' : 'template';
    markdown.value = patchDocumentFields(markdown.value, { [field]: id.value });
  }
}
function updateBody(value: string) {
  try {
    markdown.value = replaceDocumentBody(markdown.value, value);
    error.value = '';
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    let actualId = id.value;
    if (!personaForm.value) {
      const head = parseDocumentFrontmatter(markdown.value);
      if (head.status !== 'ok') throw new Error('元数据格式无效');
      actualId = String(
        head.frontmatter[props.kind === 'persona' ? 'id' : props.kind === 'skill' ? 'name' : 'template'] ?? ''
      );
    }
    const existing = props.document && !copied.value ? props.document : null;
    await getDesktopApi().content.save({
      ...context,
      kind: props.kind,
      scope: scope.value,
      id: actualId,
      markdown: serialized.value,
      ...(existing ? { sourcePath: existing.sourcePath, expectedHash: existing.hash } : {})
    });
    emit('saved');
    emit('update:open', false);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
async function confirmArchive() {
  if (!props.document) return;
  busy.value = true;
  try {
    await getDesktopApi().content.archive({ ...context, ref: toContentRef(props.document) });
    archive.value = false;
    emit('saved');
    emit('update:open', false);
  } catch (cause) {
    error.value = toErrorMessage(cause);
    archive.value = false;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AppDialog
    :open="open"
    :title="`${document?.archived ? '查看已归档' : document ? '编辑' : '新建'}${labels[kind]}`"
    content-size="lg"
    @update:open="value => !value && requestClose()"
  >
    <div class="content-editor">
      <div class="content-editor-meta">
        <label v-if="personaForm"
          >标识<AppInput
            v-model="id"
            aria-label="专员标识"
            :readonly="readonly || Boolean(document && !copied)"
            maxlength="64"
        /></label>
        <label
          >存放范围<AppSelect
            v-model="scope"
            aria-label="存放范围"
            :disabled="readonly || Boolean(document && !copied)"
          >
            <AppSelectItem value="user">所有作品</AppSelectItem
            ><AppSelectItem v-if="context.rootPath" value="workspace">当前作品</AppSelectItem>
          </AppSelect></label
        >
        <span v-if="readonly">{{ document?.archived ? '已归档' : '内置' }} · 只读</span>
      </div>
      <AppTabs
        v-if="personaForm"
        v-model="tab"
        :items="[
          { value: 'body', label: '职责正文' },
          { value: 'settings', label: '专员与权限' },
          { value: 'source', label: '完整文件' }
        ]"
        label="专员编辑视图"
      >
        <AppTextarea
          v-if="tab === 'body'"
          v-model="body"
          class="content-source"
          aria-label="职责正文"
          :readonly="readonly"
          :rows="15"
          resize="none"
        />
        <AppScrollArea v-else-if="tab === 'settings'" class="content-form-scroll"
          ><PersonaFields v-model="persona" :readonly="readonly"
        /></AppScrollArea>
        <AppTextarea
          v-else
          :model-value="serialized"
          class="content-source"
          aria-label="完整文件"
          readonly
          :rows="15"
          resize="none"
        />
      </AppTabs>
      <AppTabs
        v-else-if="kind === 'skill' || kind === 'template'"
        v-model="tab"
        :items="[
          { value: 'body', label: '正文' },
          { value: 'settings', label: kind === 'skill' ? '技能与关联' : '模板与字段' },
          { value: 'source', label: '完整文件' }
        ]"
        label="内容编辑视图"
      >
        <AppTextarea
          v-if="tab === 'body'"
          :model-value="parsedMarkdown.status === 'ok' ? parsedMarkdown.body : markdown"
          class="content-source"
          aria-label="内容正文"
          :readonly="readonly || parsedMarkdown.status !== 'ok'"
          :rows="15"
          resize="none"
          @update:model-value="updateBody"
        />
        <AppScrollArea v-else-if="tab === 'settings'" class="content-form-scroll">
          <ContentDefinitionFields
            v-model="markdown"
            :kind="kind"
            :readonly="readonly"
            :id-locked="Boolean(document && !copied)"
          />
        </AppScrollArea>
        <AppTextarea
          v-else
          v-model="markdown"
          class="content-source"
          aria-label="内容 Markdown"
          :readonly="readonly"
          :rows="15"
          resize="none"
          spellcheck="false"
        />
      </AppTabs>
      <AppTextarea
        v-else
        v-model="markdown"
        class="content-source"
        aria-label="内容 Markdown"
        :readonly="readonly"
        :rows="18"
        resize="none"
        spellcheck="false"
      />
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <AppButton v-if="document" :disabled="busy" @click="copy">复制为自定义</AppButton>
        <AppButton v-if="document && !readonly && !copied" :disabled="busy" @click="archive = true">归档</AppButton>
        <AppButton
          v-if="document && document.source !== 'builtin' && !copied"
          variant="danger"
          :disabled="busy"
          @click="emit('remove', document)"
          >永久删除</AppButton
        >
        <span class="editor-save-state">{{ dirty ? '未保存' : '' }}</span>
        <AppButton :disabled="busy" @click="requestClose">取消</AppButton>
        <AppButton v-if="!readonly" variant="primary" :disabled="busy || !serialized.trim()" @click="save"
          >保存{{ labels[kind] }}</AppButton
        >
      </footer>
    </div>
  </AppDialog>
  <AppDialog :open="discard" title="放弃未保存的内容？" @update:open="discard = $event">
    <div class="content-confirm">
      <AppButton @click="discard = false">继续编辑</AppButton
      ><AppButton
        variant="danger"
        @click="
          discard = false;
          emit('update:open', false);
        "
        >放弃修改</AppButton
      >
    </div>
  </AppDialog>
  <AppDialog
    :open="archive"
    title="归档此内容？"
    description="归档后不再加载；同名低优先级内容可能重新生效。技能附件随目录保留，可以在已归档列表中恢复。"
    @update:open="archive = $event"
  >
    <div class="content-confirm">
      <AppButton :disabled="busy" @click="archive = false">取消</AppButton
      ><AppButton variant="danger" :disabled="busy" @click="confirmArchive">归档</AppButton>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.content-editor {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  font-size: var(--ui-font-size);
  height: min(550px, calc(100vh - 170px));
}
.content-editor-meta {
  @apply flex shrink-0 flex-wrap items-end gap-3;
}
.content-editor-meta label {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}
.content-source {
  @apply min-h-0 flex-1;
  min-height: 180px;
  font-family: var(--font-mono, monospace);
}
.content-form-scroll {
  @apply min-h-0 flex-1 p-3;
}
footer {
  @apply flex shrink-0 flex-wrap items-center gap-2;
}
.editor-save-state {
  @apply ml-auto;
  color: var(--muted-foreground);
}
.content-confirm {
  @apply flex justify-end gap-2 pt-4;
}
[role='alert'] {
  @apply m-0;
  color: var(--destructive);
  overflow-wrap: anywhere;
}
</style>
