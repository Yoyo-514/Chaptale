<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppDiffView } from '@/components/AppDiffView';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { useVersionStore } from '../store';
const versions = useVersionStore();
const reasons = {
  accepted: '接受前',
  final: '定稿',
  'before-final': '定稿前',
  settlement: '结算前',
  'before-rollback': '回滚前',
  rollback: '回滚'
};
const timestamp = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
</script>
<template>
  <AppDialog
    :open="Boolean(versions.current)"
    title="文档版本"
    :description="versions.current?.relativePath"
    content-size="lg"
    @update:open="open => !open && !versions.busy && (versions.current = null)"
  >
    <div v-if="versions.current" class="version-dialog">
      <p v-if="versions.error" role="alert">{{ versions.error }}</p>
      <AppSelect
        v-if="versions.snapshots.length"
        :model-value="versions.selected?.snapshot.id"
        aria-label="历史版本"
        @update:model-value="versions.select"
      >
        <AppSelectItem v-for="snapshot in versions.snapshots" :key="snapshot.id" :value="snapshot.id"
          >{{ timestamp(snapshot.createdAt) }} · {{ reasons[snapshot.reason] }} ·
          {{ snapshot.id.slice(0, 8) }}</AppSelectItem
        >
      </AppSelect>
      <p v-if="versions.selected" class="version-meta">
        {{ versions.selected.snapshot.targetPath }} · {{ versions.selected.snapshot.contentHash.slice(0, 12) }}
      </p>
      <AppDiffView
        v-if="versions.selected"
        :original="versions.selected.content"
        :modified="versions.current.content"
        original-label="历史快照"
        modified-label="当前版本"
      />
      <p v-else class="version-empty" role="status">
        {{ versions.snapshots.length ? '正在读取版本' : '尚无版本快照' }}
      </p>
      <p v-if="versions.selected?.snapshot.contentHash === versions.current.contentHash" role="status">
        当前文件与此快照一致
      </p>
      <footer>
        <AppButton :disabled="versions.busy" @click="versions.current = null">关闭</AppButton>
        <AppButton
          variant="primary"
          :disabled="
            versions.busy ||
            !versions.selected ||
            versions.selected.snapshot.contentHash === versions.current.contentHash
          "
          @click="versions.restore"
          >回滚到该版本</AppButton
        >
      </footer>
    </div>
  </AppDialog>
  <AppDialog
    :open="Boolean(versions.finalizing)"
    title="定稿当前章节"
    :description="versions.finalizing?.relativePath"
    @update:open="open => !open && !versions.busy && (versions.finalizing = null)"
  >
    <div class="version-confirm">
      <p>本次定稿将保留正文快照，并将章节标记为已定稿。</p>
      <p v-if="versions.error" role="alert">{{ versions.error }}</p>
      <footer>
        <AppButton :disabled="versions.busy" @click="versions.finalizing = null">取消</AppButton
        ><AppButton variant="primary" :disabled="versions.busy" @click="versions.finalize">确认定稿</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.version-dialog {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  height: 68vh;
  font-size: var(--ui-font-size);
}
.version-confirm {
  @apply flex flex-col gap-3 pt-3;
  font-size: var(--ui-font-size);
}
.version-meta,
.version-empty {
  color: var(--muted-foreground);
}
.version-meta {
  font-size: var(--ui-caption-size);
}
.version-empty {
  @apply flex-1;
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
