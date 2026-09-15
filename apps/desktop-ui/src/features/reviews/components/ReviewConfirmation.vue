<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { useReviewStore } from '../store';

const reviews = useReviewStore();
</script>

<template>
  <AppDialog
    :open="Boolean(reviews.confirmation)"
    title="启动独立审查"
    @update:open="open => !open && (reviews.confirmation = null)"
  >
    <div v-if="reviews.confirmation" class="review-confirm">
      <p>{{ reviews.confirmation.targetPath }} · {{ reviews.confirmation.candidateId ? '候选稿' : '已保存正文' }}</p>
      <p>本次写作参考：{{ reviews.confirmation.packId?.slice(0, 8) ?? '未选择' }}</p>
      <label v-for="reviewer in reviews.reviewers" :key="reviewer.id">
        <AppCheckbox
          :model-value="reviews.enabled.includes(reviewer.id)"
          @update:model-value="
            reviews.enabled =
              $event === true
                ? [...new Set([...reviews.enabled, reviewer.id])]
                : reviews.enabled.filter(id => id !== reviewer.id)
          "
        />{{ reviewer.label }}审查
      </label>
      <label>
        模型<AppSelect
          :model-value="
            String(
              reviews.models.findIndex(
                model =>
                  model.provider === reviews.confirmation?.model.provider &&
                  model.id === reviews.confirmation.model.modelId
              )
            )
          "
          @update:model-value="
            value => {
              const model = reviews.models[Number(value)];
              if (model && reviews.confirmation)
                reviews.confirmation.model = { provider: model.provider, modelId: model.id };
            }
          "
        >
          <AppSelectItem v-for="(model, index) in reviews.models" :key="index" :value="String(index)">
            {{ model.providerName }} / {{ model.name }}
          </AppSelectItem>
        </AppSelect>
      </label>
      <label>
        <AppCheckbox
          :model-value="reviews.confirmation.allowStalePack"
          @update:model-value="reviews.confirmation.allowStalePack = $event === true"
        />允许使用来源已更新的旧参考快照
      </label>
      <footer>
        <AppButton :disabled="!reviews.enabled.length" @click="reviews.start">启动审查</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>

<style scoped lang="scss">
.review-confirm {
  @apply flex min-h-0 flex-col gap-4 overflow-auto pt-3;
  font-size: var(--ui-font-size);
}
label {
  @apply flex flex-wrap items-center gap-2;
}
p {
  @apply m-0;
  overflow-wrap: anywhere;
}
footer {
  @apply flex justify-end;
}
</style>
