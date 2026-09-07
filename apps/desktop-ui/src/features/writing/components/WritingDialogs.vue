<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { normalizeDocumentText } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';
import { useLibraryStore } from '@/features/library';
import { useReviewStore } from '@/features/reviews';

import { useWritingStore } from '../store';

const writing = useWritingStore();
const library = useLibraryStore();
const reviews = useReviewStore();
const selection = ref({ from: 0, to: 0 });
const currentBlock = ref(0);
const confirmAll = ref(false);
const details = computed(() => writing.details);
const candidate = computed(() => details.value?.candidate);
const selectedBlocks = computed(
  () =>
    details.value?.changes.flatMap((change, index) =>
      change.fromA === change.toA
        ? change.fromA >= selection.value.from && change.fromA <= selection.value.to
          ? [index]
          : []
        : change.fromA < selection.value.to && change.toA > selection.value.from
          ? [index]
          : []
    ) ?? []
);
const stats = computed(() =>
  details.value?.changes.reduce(
    (sum, change) => ({
      removed: sum.removed + change.toA - change.fromA,
      added: sum.added + change.toB - change.fromB
    }),
    { removed: 0, added: 0 }
  )
);
watch(
  () => candidate.value?.revision,
  () => {
    confirmAll.value = false;
    currentBlock.value = 0;
    selection.value = { from: 0, to: 0 };
  }
);
function changeModel(event: Event) {
  if (!writing.draft) return;
  const model = writing.models[Number((event.target as HTMLSelectElement).value)];
  if (model) writing.draft.model = { provider: model.provider, modelId: model.id };
}
</script>
<template>
  <AppDialog :open="Boolean(writing.draft)" title="创建候选稿" @update:open="open => !open && (writing.draft = null)">
    <div v-if="writing.draft" class="draft-confirm">
      <dl>
        <dt>目标章节</dt>
        <dd>{{ writing.draft.targetPath }}</dd>
        <dt>替换范围</dt>
        <dd>
          {{ writing.draft.range.from }} – {{ writing.draft.range.to }}（{{
            writing.draft.range.to - writing.draft.range.from
          }}
          字符）
        </dd>
        <dt>写作目标</dt>
        <dd>{{ library.frozen?.goal }}</dd>
        <dt>本次写作参考</dt>
        <dd>
          {{ writing.draft.packId.slice(0, 8) }} · {{ library.frozen?.chars }} 字 · 约
          {{ library.frozen?.tokens }} tokens
        </dd>
        <dt>Persona</dt>
        <dd>draft</dd>
      </dl>
      <label
        >写入范围<select
          aria-label="候选目标范围"
          :value="
            writing.ranges.findIndex(
              range => range.from === writing.draft?.range.from && range.to === writing.draft.range.to
            )
          "
          @change="
            event => {
              const range = writing.ranges[Number((event.target as HTMLSelectElement).value)];
              if (range && writing.draft) writing.draft.range = { from: range.from, to: range.to };
            }
          "
        >
          <option v-for="(range, index) in writing.ranges" :key="index" :value="index">{{ range.label }}</option>
        </select></label
      >
      <label
        >模型<select
          :value="
            writing.models.findIndex(
              model => model.provider === writing.draft?.model.provider && model.id === writing.draft.model.modelId
            )
          "
          @change="changeModel"
        >
          <option v-for="(model, index) in writing.models" :key="`${model.provider}/${model.id}`" :value="index">
            {{ model.providerName }} / {{ model.name }}
          </option>
        </select></label
      >
      <label><input v-model="writing.draft.allowStalePack" type="checkbox" />允许使用来源已更新的旧快照</label>
      <footer>
        <AppButton size="sm" @click="writing.draft = null">取消</AppButton
        ><AppButton size="sm" @click="writing.generate">创建候选</AppButton>
      </footer>
    </div>
  </AppDialog>
  <AppDialog
    :open="Boolean(candidate)"
    title="候选差异"
    :description="candidate?.targetPath"
    content-size="lg"
    @update:open="open => !open && (writing.details = null)"
  >
    <div v-if="candidate && details" class="candidate-diff">
      <div class="candidate-meta">
        <span>{{ candidate.personaId }} · {{ candidate.model.provider }}/{{ candidate.model.modelId }}</span
        ><span>{{ candidate.acceptances.length }} 次接受 · {{ details.changes.length }} 块差异</span>
      </div>
      <p v-if="candidate.status === 'stale'" role="status">正文已变化，此候选不能直接接受。</p>
      <p v-if="writing.error || candidate.error" role="alert">{{ writing.error || candidate.error }}</p>
      <AppDiffView
        :original="normalizeDocumentText(candidate.baselineContent)"
        :modified="normalizeDocumentText(candidate.proposedContent)"
        original-label="正文基线"
        modified-label="候选稿"
        @selection="selection = $event"
      />
      <div v-if="writing.usable && details.changes.length" class="candidate-actions">
        <select v-model.number="currentBlock" aria-label="当前差异块">
          <option v-for="(change, index) in details.changes" :key="index" :value="index">
            第 {{ index + 1 }} 块 · {{ change.toB - change.fromB }} 字符
          </option>
        </select>
        <AppButton size="xs" :disabled="writing.busy" @click="writing.apply([currentBlock])">接受当前块</AppButton>
        <AppButton
          size="xs"
          :disabled="writing.busy || selection.from === selection.to || !selectedBlocks.length"
          @click="writing.apply(selectedBlocks)"
          >接受选区</AppButton
        >
        <AppButton size="xs" :disabled="writing.busy" @click="confirmAll = true">全部接受</AppButton>
      </div>
      <div v-if="confirmAll && writing.usable" class="candidate-confirm">
        <span>{{ candidate.targetPath }} · 移除 {{ stats?.removed }} / 加入 {{ stats?.added }} 字符</span>
        <AppButton size="xs" :disabled="writing.busy" @click="writing.apply(details.changes.map((_, index) => index))"
          >确认全部接受</AppButton
        >
        <AppButton size="xs" @click="confirmAll = false">取消</AppButton>
      </div>
      <footer>
        <AppButton
          v-if="['ready', 'partially-accepted', 'accepted'].includes(candidate.status)"
          size="xs"
          @click="
            reviews.prepare(undefined, candidate);
            writing.details = null;
          "
          >审查候选稿</AppButton
        >
        <AppButton
          v-if="candidate.status === 'stale' || candidate.status === 'failed' || candidate.status === 'cancelled'"
          size="xs"
          @click="
            writing.prepare(candidate.id);
            writing.details = null;
          "
          >基于当前正文重新生成</AppButton
        >
        <AppButton
          v-if="!['accepted', 'discarded', 'generating', 'preparing'].includes(candidate.status)"
          size="xs"
          :disabled="writing.busy"
          @click="writing.discard"
          >放弃候选</AppButton
        >
        <AppButton size="xs" @click="writing.details = null">关闭</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.draft-confirm {
  @apply flex min-h-0 flex-col gap-3 overflow-auto pt-3 text-xs;
}
dl {
  @apply grid grid-cols-[7rem_1fr] gap-2;
}
dt {
  color: var(--muted-foreground);
}
dd {
  @apply m-0 min-w-0 whitespace-pre-wrap;
  overflow-wrap: anywhere;
}
label {
  @apply flex flex-wrap items-center gap-2;
}
select {
  @apply max-w-full min-w-0 rounded border px-2 py-1 text-xs;
  background: var(--input-background);
  color: var(--foreground);
}
footer {
  @apply flex shrink-0 flex-wrap justify-end gap-2;
}
.candidate-diff {
  @apply flex min-h-0 flex-col gap-3 pt-3 text-xs;
  height: min(70vh, 38rem);
}
.candidate-meta {
  @apply flex shrink-0 flex-wrap justify-between gap-2;
  overflow-wrap: anywhere;
}
.candidate-actions,
.candidate-confirm {
  @apply flex shrink-0 flex-wrap items-center gap-2;
}
.candidate-confirm span {
  @apply min-w-0 flex-1;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
