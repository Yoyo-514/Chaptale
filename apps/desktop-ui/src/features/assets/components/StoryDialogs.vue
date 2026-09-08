<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCombobox } from '@/components/AppCombobox';
import { AppDialog } from '@/components/AppDialog';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppTextarea } from '@/components/AppTextarea';
import { useLibraryStore } from '@/features/library';
import { TemplateFields } from '@/features/templates';

import { useStoryStore } from '../story-store';

const story = useStoryStore();
const library = useLibraryStore();
const options = computed(() =>
  story.characters.map(asset => ({ value: asset.sourcePath, label: asset.title, description: asset.sourcePath }))
);
</script>
<template>
  <AppDialog
    :open="Boolean(story.relation)"
    :title="
      story.relation?.removing ? '移除角色关系' : story.relation?.index === null ? '新建角色关系' : '编辑角色关系'
    "
    @update:open="open => !open && story.closeRelation()"
  >
    <AppForm v-if="story.relation" class="story-form" :disabled="story.busy" @submit="story.saveRelation">
      <template v-if="!story.relation.removing">
        <label
          >源角色<AppCombobox
            :model-value="story.relation.sourcePath"
            :options="options"
            aria-label="源角色"
            :disabled="story.relation.index !== null"
            @update:model-value="story.selectSource($event)"
        /></label>
        <label
          >目标角色<AppCombobox
            v-model="story.relation.targetPath"
            :options="options.filter(option => option.value !== story.relation?.sourcePath)"
            aria-label="目标角色"
        /></label>
        <label>关系称谓<AppInput v-model="story.relation.type" aria-label="关系称谓" maxlength="200" /></label>
        <label
          >关系备注<AppTextarea v-model="story.relation.note" aria-label="关系备注" :rows="3" maxlength="4000"
        /></label>
      </template>
      <p v-else>{{ story.sourceName }} → {{ story.relation.targetPath }} · {{ story.relation.type }}</p>
      <p v-if="story.loading" role="status">正在读取角色文件</p>
      <p v-if="story.error" class="story-error" role="alert">{{ story.error }}</p>
      <AppFormActions>
        <AppButton
          v-if="story.relation.index !== null && !story.relation.removing"
          variant="danger"
          @click="story.relation.removing = true"
          >移除关系…</AppButton
        >
        <AppButton @click="story.relation.removing ? (story.relation.removing = false) : story.closeRelation()"
          >取消</AppButton
        >
        <AppButton
          type="submit"
          :variant="story.relation.removing ? 'danger' : 'primary'"
          :disabled="story.busy || story.loading || !story.relationDocument"
        >
          <span
            :class="story.relation.removing ? 'i-mingcute-delete-2-line' : 'i-mingcute-save-line'"
            aria-hidden="true"
          />{{ story.relation.removing ? '确认移除关系' : '保存关系' }}
        </AppButton>
      </AppFormActions>
    </AppForm>
  </AppDialog>
  <AppDialog
    :open="Boolean(story.event)"
    title="编辑故事事件"
    content-size="lg"
    @update:open="open => !open && story.closeEvent()"
  >
    <AppForm v-if="story.event" class="story-form" :disabled="story.busy || story.loading" @submit="story.saveEvent">
      <TemplateFields
        v-if="story.eventTemplate"
        :fields="story.eventTemplate.fields"
        :values="story.event.values"
        :assets="library.available"
        @field="(key, value) => story.event && (story.event.values[key] = value)"
      />
      <p v-if="story.loading" role="status">正在读取故事事件</p>
      <p v-if="story.error" class="story-error" role="alert">{{ story.error }}</p>
      <AppFormActions>
        <AppButton @click="story.closeEvent">取消</AppButton>
        <AppButton type="submit" variant="primary" :disabled="!story.eventDocument || story.busy || story.loading"
          ><span class="i-mingcute-save-line" aria-hidden="true" />保存事件</AppButton
        >
      </AppFormActions>
    </AppForm>
  </AppDialog>
</template>
<style scoped lang="scss">
.story-form {
  @apply grid min-h-0 gap-4 overflow-auto pt-4;
  font-size: var(--ui-font-size);
}
.story-form label {
  @apply grid min-w-0 gap-1.5;
}
.story-form p {
  @apply m-0;
  overflow-wrap: anywhere;
}
.story-error {
  color: var(--destructive);
}
</style>
