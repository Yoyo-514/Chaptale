<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';

import { useAssetStore } from '../store';
const assets = useAssetStore();
</script>
<template>
  <AppDialog
    :open="Boolean(assets.pending)"
    title="待确认事实"
    :description="assets.pending?.proposal.targetPath"
    content-size="lg"
    @update:open="open => !open && !assets.busy && (assets.pending = null)"
  >
    <div v-if="assets.pending" class="asset-pending-dialog">
      <p>{{ assets.pending.proposal.title }} · {{ assets.pending.proposal.source }}</p>
      <p>{{ assets.pending.proposal.reason }}</p>
      <p v-if="assets.pending.conflict || assets.error" role="alert">{{ assets.pending.conflict || assets.error }}</p>
      <AppDiffView
        :original="assets.pending.original"
        :modified="assets.pending.modified"
        original-label="当前资产"
        modified-label="提议内容"
      />
      <footer>
        <AppButton :disabled="assets.busy" @click="assets.pending = null">关闭</AppButton>
        <AppButton :disabled="assets.busy" @click="assets.resolve('reject')">拒绝提议</AppButton>
        <AppButton
          variant="primary"
          :disabled="assets.busy || Boolean(assets.pending.conflict)"
          @click="assets.resolve('accept')"
          >接受提议</AppButton
        >
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.asset-pending-dialog {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  height: 68vh;
  font-size: var(--ui-font-size);
}
p {
  @apply m-0;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
footer {
  @apply flex shrink-0 flex-wrap justify-end gap-2;
}
</style>
