<script setup lang="ts">
import { ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useEditorStore } from '@/features/editor';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCreationStore } from '../store';

const creation = useCreationStore();
const editor = useEditorStore();
const title = ref('');
const kind = ref<'novel' | 'script'>('novel');
const busy = ref(false);
const error = ref('');
const guidelines = ref('');
const guidelinesBusy = ref(false);
const guidelinesError = ref('');
let previous = '';
let commandId = '';
let guidelinesPrevious = '';
let guidelinesCommandId = '';
watch(
  () => [creation.newWorkOpen, creation.newEntry],
  () => {
    title.value = '';
    error.value = '';
    previous = '';
    commandId = '';
  }
);
watch(
  () => creation.writingGuidelinesOpen,
  open => {
    if (!open) return;
    guidelines.value = creation.writingGuidelines;
    guidelinesError.value = '';
    guidelinesPrevious = '';
    guidelinesCommandId = '';
  }
);
async function create() {
  if (busy.value || !title.value.trim()) return;
  busy.value = true;
  error.value = '';
  const identity = JSON.stringify([creation.newWorkOpen, creation.workId, creation.newEntry, title.value, kind.value]);
  if (previous !== identity) {
    previous = identity;
    commandId = crypto.randomUUID();
  }
  try {
    if (creation.newWorkOpen) await creation.createWork(title.value, kind.value, commandId);
    else {
      const entry = await creation.createEntry(title.value, 'txt', commandId);
      if (entry.kind === 'document') await editor.openDocument(entry.id);
    }
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function close() {
  if (!busy.value) {
    creation.newWorkOpen = false;
    creation.newEntry = null;
  }
}
async function submitGuidelines() {
  if (guidelinesBusy.value || !creation.workId) return;
  guidelinesBusy.value = true;
  guidelinesError.value = '';
  const identity = JSON.stringify([creation.workId, guidelines.value]);
  if (guidelinesPrevious !== identity) {
    guidelinesPrevious = identity;
    guidelinesCommandId = crypto.randomUUID();
  }
  try {
    await creation.saveWritingGuidelines(guidelines.value, guidelinesCommandId);
  } catch (cause) {
    guidelinesError.value = toErrorMessage(cause);
  } finally {
    guidelinesBusy.value = false;
  }
}
function closeGuidelines() {
  if (!guidelinesBusy.value) creation.writingGuidelinesOpen = false;
}
</script>

<template>
  <AppDialog
    content-size="sm"
    :open="creation.newWorkOpen || Boolean(creation.newEntry)"
    :title="creation.newWorkOpen ? '新建作品' : creation.newEntry?.kind === 'directory' ? '新建目录' : '新建文档'"
    @update:open="open => !open && close()"
  >
    <AppForm class="creation-form" :disabled="busy" @submit="create">
      <label
        >{{ creation.newWorkOpen ? '作品名称' : creation.newEntry?.kind === 'directory' ? '目录名称' : '文档标题' }}
        <AppInput
          v-model="title"
          :aria-label="
            creation.newWorkOpen ? '作品名称' : creation.newEntry?.kind === 'directory' ? '目录名称' : '文档标题'
          "
          autofocus
        />
      </label>
      <label v-if="creation.newWorkOpen"
        >作品类型
        <AppSelect v-model="kind" aria-label="作品类型"
          ><AppSelectItem value="novel">小说</AppSelectItem
          ><AppSelectItem value="script">剧本</AppSelectItem></AppSelect
        >
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <AppFormActions>
        <AppButton :disabled="busy" @click="close">取消</AppButton>
        <AppButton type="submit" variant="primary" :disabled="busy || !title.trim()">{{
          busy
            ? '正在创建…'
            : creation.newWorkOpen
              ? '创建作品'
              : creation.newEntry?.kind === 'directory'
                ? '创建目录'
                : '创建文档'
        }}</AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
  <AppDialog
    content-size="md"
    :open="creation.writingGuidelinesOpen"
    title="写作要求"
    description="设定本作品的人称、叙事视角、文风或禁用词等全局规范，归属本作品的会话会自动遵循；留空表示不额外限定。"
    @update:open="open => !open && closeGuidelines()"
  >
    <AppForm class="creation-form" :disabled="guidelinesBusy" @submit="submitGuidelines">
      <label
        >写作要求
        <AppTextarea
          v-model="guidelines"
          aria-label="写作要求"
          :rows="7"
          placeholder="例如：采用第三人称限知视角；语言克制平实，不使用现代网络流行语。"
          autofocus
        />
      </label>
      <p v-if="guidelinesError" role="alert">{{ guidelinesError }}</p>
      <AppFormActions>
        <AppButton :disabled="guidelinesBusy" @click="closeGuidelines">取消</AppButton>
        <AppButton type="submit" variant="primary" :disabled="guidelinesBusy">{{
          guidelinesBusy ? '正在保存…' : '保存'
        }}</AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>
<style scoped>
.creation-form {
  padding: 12px 0 0;
  display: grid;
  gap: 12px;
}
label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
p {
  margin: 0;
  color: var(--destructive);
}
</style>
