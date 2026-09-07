<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTextarea } from '@/components/AppTextarea';
import { useEditorStore } from '@/features/editor';

import { useSettlementStore } from '../store';
const settlement = useSettlementStore();
const editor = useEditorStore();
const batch = computed(() => settlement.details?.batch);
const selected = ref('');
const drafts = ref<Record<string, string>>({});
const editing = ref(false);
const item = computed(() => batch.value?.items.find(value => value.id === selected.value));
const content = computed({
  get: () =>
    item.value ? (drafts.value[item.value.id] ?? item.value.editedContent ?? item.value.proposedContent) : '',
  set: value => {
    if (item.value) drafts.value[item.value.id] = value;
  }
});
const categories = { summary: '章节摘要', character: '角色状态', 'plot-thread': '伏笔推进', timeline: '时间线事件' };
const statuses = { pending: '待确认', accepted: '已接受', rejected: '已拒绝' };
const conflict = computed(() => item.value && settlement.details?.conflicts.includes(item.value.targetPath));
const complete = computed(
  () =>
    batch.value?.status === 'ready' &&
    batch.value.items.every(value => value.status !== 'pending') &&
    !settlement.details?.stale
);
watch([() => batch.value?.id, () => settlement.focusedTarget], () => {
  selected.value =
    batch.value?.items.find(value => value.targetPath === settlement.focusedTarget)?.id ??
    batch.value?.items.find(value => value.status === 'pending')?.id ??
    batch.value?.items[0]?.id ??
    '';
  drafts.value = {};
  editing.value = false;
});
watch(selected, () => {
  editing.value = false;
});
function selectModel(value: string) {
  const model = settlement.models[Number(value)];
  if (model && settlement.confirmation)
    settlement.confirmation.request.model = { provider: model.provider, modelId: model.id };
}
</script>
<template>
  <AppDialog
    :open="Boolean(settlement.confirmation)"
    title="结算本章"
    @update:open="open => !open && (settlement.confirmation = null)"
  >
    <div v-if="settlement.confirmation" class="settlement-confirm">
      <dl>
        <dt>章节</dt>
        <dd>{{ settlement.confirmation.plan.chapterPath }}</dd>
        <dt>本次写作参考</dt>
        <dd>{{ settlement.confirmation.plan.packId }} · 约 {{ settlement.confirmation.plan.tokens }} tokens</dd>
        <dt>Persona</dt>
        <dd>chapter-distiller</dd>
      </dl>
      <details>
        <summary>{{ settlement.confirmation.plan.sources.length }} 个来源</summary>
        <p v-for="source in settlement.confirmation.plan.sources" :key="source">{{ source }}</p>
      </details>
      <label
        >模型<AppSelect
          :model-value="
            String(
              settlement.models.findIndex(
                model =>
                  model.provider === settlement.confirmation?.request.model.provider &&
                  model.id === settlement.confirmation.request.model.modelId
              )
            )
          "
          aria-label="结算模型"
          @update:model-value="selectModel"
        >
          <AppSelectItem v-if="!settlement.models.length" value="-1" disabled>尚未配置模型</AppSelectItem>
          <AppSelectItem
            v-for="(model, index) in settlement.models"
            :key="`${model.provider}/${model.id}`"
            :value="String(index)"
            >{{ model.providerName }} / {{ model.name }}</AppSelectItem
          >
        </AppSelect></label
      >
      <label class="settlement-check"
        ><AppCheckbox
          :model-value="settlement.confirmation.request.autoAcceptSummary"
          @update:model-value="settlement.confirmation.request.autoAcceptSummary = $event === true"
        />本次自动接受摘要</label
      >
      <p v-if="settlement.error" role="alert">{{ settlement.error }}</p>
      <footer>
        <AppButton @click="settlement.confirmation = null">取消</AppButton
        ><AppButton
          variant="primary"
          :disabled="!settlement.confirmation.request.model.modelId"
          @click="settlement.start"
          >生成待确认事实</AppButton
        >
      </footer>
    </div>
  </AppDialog>
  <AppDialog
    :open="Boolean(batch)"
    title="结算批次"
    :description="batch?.chapterPath"
    content-size="lg"
    @update:open="open => !open && !settlement.busy && (settlement.details = null)"
  >
    <div v-if="batch" class="settlement-detail">
      <div class="settlement-meta">
        <span>{{ batch.personaId }} · {{ batch.model.provider }}/{{ batch.model.modelId }}</span
        ><span>{{ batch.items.filter(value => value.status === 'pending').length }} 项待确认</span>
      </div>
      <p v-if="settlement.error || batch.error" role="alert">{{ settlement.error || batch.error }}</p>
      <p v-if="settlement.details?.stale" role="alert">正文已变化，请重新结算。未接受提议不会自动写回。</p>
      <p v-if="batch.status === 'completed'" role="status">本章结算已完成</p>
      <AppSelect v-if="batch.items.length" v-model="selected" aria-label="结算提议">
        <AppSelectItem v-for="value in batch.items" :key="value.id" :value="value.id"
          >{{ categories[value.category] }} · {{ value.title }} · {{ statuses[value.status] }}</AppSelectItem
        >
      </AppSelect>
      <template v-if="item">
        <div class="settlement-target">
          <span>{{ item.targetPath }}</span
          ><AppButton
            v-if="item.baseline || item.status === 'accepted'"
            icon
            size="xs"
            variant="ghost"
            aria-label="打开提议目标"
            @click="editor.openDocument(item.targetPath)"
            ><span class="i-mingcute-external-link-line"
          /></AppButton>
        </div>
        <p class="settlement-reason">{{ item.reason }}</p>
        <p v-if="conflict" role="alert">目标资产已变化，保留当前文件；可拒绝旧提议后重新结算。</p>
        <AppTextarea v-if="editing" v-model="content" class="settlement-edit" :rows="10" aria-label="编辑待确认事实" />
        <AppDiffView
          v-else
          :original="item.baseline?.content ?? ''"
          :modified="content"
          original-label="结算时版本"
          modified-label="待确认内容"
        />
        <div v-if="item.status === 'pending' && batch.status === 'ready'" class="settlement-actions">
          <AppButton :disabled="settlement.busy || Boolean(item.applying)" @click="editing = !editing">{{
            editing ? '查看差异' : '编辑提议'
          }}</AppButton>
          <AppButton
            v-if="drafts[item.id] !== undefined"
            :disabled="settlement.busy || Boolean(item.applying)"
            @click="delete drafts[item.id]"
            >放弃编辑</AppButton
          >
          <AppButton :disabled="settlement.busy" @click="settlement.resolve(item.id, 'reject')">拒绝提议</AppButton>
          <AppButton
            variant="primary"
            :disabled="settlement.busy || (!item.applying && (settlement.details?.stale || conflict))"
            @click="settlement.resolve(item.id, 'accept', drafts[item.id])"
            >{{ item.applying ? '恢复接受' : drafts[item.id] === undefined ? '接受提议' : '编辑后接受' }}</AppButton
          >
        </div>
      </template>
      <footer>
        <AppButton
          v-if="batch.status === 'failed' || batch.status === 'cancelled' || settlement.details?.stale"
          :disabled="settlement.busy"
          @click="settlement.prepare(batch.chapterPath)"
          >重新结算</AppButton
        >
        <AppButton v-if="complete" variant="primary" :disabled="settlement.busy" @click="settlement.complete"
          >完成结算</AppButton
        >
        <AppButton :disabled="settlement.busy" @click="settlement.details = null">关闭</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.settlement-confirm {
  @apply flex min-h-0 flex-col gap-4 overflow-auto pt-3;
  font-size: var(--ui-font-size);
}
dl {
  @apply m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2;
}
dt {
  color: var(--muted-foreground);
}
dd {
  @apply m-0 break-words;
}
label {
  @apply flex flex-col gap-2;
}
.settlement-check {
  @apply flex-row items-center;
}
.settlement-detail {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  height: 68vh;
  font-size: var(--ui-font-size);
}
.settlement-meta,
.settlement-target,
.settlement-actions,
footer {
  @apply flex shrink-0 flex-wrap items-center gap-2;
}
.settlement-meta {
  @apply justify-between;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.settlement-target span {
  @apply min-w-0 flex-1 break-words;
}
.settlement-edit {
  @apply min-h-24 flex-1;
}
.settlement-reason,
p {
  @apply m-0 break-words;
}
footer {
  @apply justify-end;
}
[role='alert'] {
  color: var(--destructive);
}
@media (max-height: 700px) {
  .settlement-detail {
    overflow: auto;
  }
}
</style>
