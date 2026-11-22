<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

import type { EditorContext, MessageBranch, SkillInvocationView } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppTextarea } from '@/components/AppTextarea';

import { formatSkillPrompt } from '../skills';
import EditorContextBadge from './EditorContextBadge.vue';
import MessageActions from './MessageActions.vue';
import SkillBadge from './SkillBadge.vue';

const props = defineProps<{
  entryId?: string;
  text: string;
  compacted?: boolean;
  editorContext?: EditorContext;
  skill?: SkillInvocationView;
  branch?: MessageBranch;
  readonly?: boolean;
  busy?: boolean;
  alwaysShowActions?: boolean;
}>();

const emit = defineEmits<{
  editMessage: [payload: { entryId: string; text: string; editorContext?: EditorContext }];
  switchBranch: [leafId: string];
}>();

const draft = defineModel<string | null>('draft', { default: null });
const editing = computed(() => draft.value !== null);
const editor = ref<InstanceType<typeof AppTextarea>>();
const rawPrompt = computed(() => formatSkillPrompt(props.text, props.skill));

async function startEdit() {
  if (!props.entryId || props.readonly || props.busy) return;
  draft.value = rawPrompt.value;
  await nextTick();
  editor.value?.focus();
}

function cancelEdit() {
  draft.value = null;
}

function submitEdit() {
  const next = draft.value!.trim();
  if (!next || !props.entryId || props.busy) return;
  draft.value = null;
  emit('editMessage', { entryId: props.entryId, text: next, editorContext: props.editorContext });
}

/** 与输入框一致：Enter 发送，Shift + Enter 换行，输入法选字时的 Enter 不发送。 */
function onEditKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  submitEdit();
}

function retry() {
  if (!props.entryId || props.busy) return;
  emit('editMessage', { entryId: props.entryId, text: rawPrompt.value, editorContext: props.editorContext });
}
</script>

<template>
  <article class="agent-user" :class="{ 'is-compacted': compacted, 'is-editing': editing }" aria-label="作者">
    <div v-if="editing" class="agent-user-edit">
      <EditorContextBadge v-if="editorContext" :context="editorContext" />
      <AppTextarea
        ref="editor"
        :model-value="draft!"
        aria-label="编辑消息"
        @update:model-value="draft = $event"
        :rows="2"
        variant="plain"
        resize="auto"
        @keydown="onEditKeydown"
        @keydown.esc.prevent="cancelEdit"
      />
      <div class="agent-user-edit-actions">
        <AppButton type="button" size="xs" variant="ghost" @click="cancelEdit">取消</AppButton>
        <AppButton type="button" size="xs" variant="primary" :disabled="!draft!.trim() || busy" @click="submitEdit">
          发送
        </AppButton>
      </div>
    </div>
    <div v-else class="agent-user-body">
      <EditorContextBadge v-if="editorContext" :context="editorContext" />
      <SkillBadge v-if="skill" :name="skill.name" />
      <div v-if="text || !skill" class="agent-user-text">{{ text }}</div>
      <MessageActions
        align="end"
        :copy-text="rawPrompt"
        :branch="branch"
        :can-edit="!readonly && Boolean(entryId)"
        :can-retry="!readonly && Boolean(entryId)"
        :disabled="busy || readonly"
        :always-visible="alwaysShowActions"
        @edit="startEdit"
        @retry="retry"
        @switch-branch="emit('switchBranch', $event)"
      />
    </div>
  </article>
</template>

<style lang="scss">
.agent-user-edit {
  display: flex;
  width: min(100%, 34rem);
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--ring);
  border-radius: 12px;
  background: var(--input);
}
.agent-user-edit textarea {
  min-height: 3rem;
  max-height: 12rem;
  padding: 2px 4px;
  font-size: 14px;
  line-height: 1.7;
}
.agent-user-edit-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}
</style>
