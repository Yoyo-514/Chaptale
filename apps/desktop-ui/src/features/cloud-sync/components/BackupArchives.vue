<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';

import { formatSize, formatWhen } from '../presentation';
import { useCloudSyncStore } from '../store';

const cloud = useCloudSyncStore();
const selection = ref<string[]>([]);
const isRemovalPending = ref(false);
const isRemoving = ref(false);
const busy = computed(() => cloud.isBackupRunning || cloud.isApplying || cloud.isPlanLoading || isRemoving.value);

function setRemoval(id: string, selected: boolean) {
  if (selection.value.includes(id) === selected) return;
  selection.value = selected ? [...selection.value, id] : selection.value.filter(value => value !== id);
  isRemovalPending.value = false;
}
async function confirmRemoval() {
  if (busy.value || !selection.value.length) return;
  const ids = [...selection.value];
  isRemoving.value = true;
  isRemovalPending.value = false;
  try {
    await cloud.removeBackups(ids);
  } finally {
    isRemoving.value = false;
  }
}
watch(
  () => cloud.archives,
  archives => {
    const ids = new Set(archives.map(item => item.id));
    selection.value = selection.value.filter(id => ids.has(id));
    isRemovalPending.value = false;
  }
);
watch(
  () => [cloud.binding?.provider, cloud.binding?.folderId],
  () => {
    selection.value = [];
    isRemovalPending.value = false;
  }
);
</script>

<template>
  <div class="cloud-archives">
    <p v-if="!cloud.archives.length" class="cloud-muted">云端还没有归档。</p>
    <template v-else>
      <div class="cloud-files-head">
        <span class="cloud-muted">已选 {{ selection.length }} 份 · 共 {{ cloud.archives.length }} 份</span>
        <div class="cloud-actions">
          <template v-if="isRemovalPending">
            <AppButton variant="danger" :disabled="busy" @click="confirmRemoval"
              >确认删除 {{ selection.length }} 份</AppButton
            >
            <AppButton variant="ghost" @click="isRemovalPending = false">取消</AppButton>
          </template>
          <AppButton v-else variant="ghost" :disabled="!selection.length || busy" @click="isRemovalPending = true">
            <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />删除所选
          </AppButton>
        </div>
      </div>
      <p v-if="isRemovalPending" class="cloud-error" role="alert">
        从云端删除后无法恢复，请确认这 {{ selection.length }} 份归档不再需要。
      </p>
      <p v-if="isRemoving" class="cloud-muted" role="status">正在删除归档…</p>
      <ul class="cloud-files">
        <li v-for="item in cloud.archives" :key="item.id" class="cloud-file">
          <label class="cloud-file-copy">
            <AppCheckbox
              :model-value="selection.includes(item.id)"
              :aria-label="`选择归档 ${item.name}`"
              :disabled="busy"
              @update:model-value="setRemoval(item.id, $event === true)"
            />
            <span class="cloud-file-name">{{ item.name }}</span>
            <span class="cloud-file-meta cloud-muted">
              {{ formatSize(item.sizeBytes)
              }}<template v-if="item.modifiedAt"> · {{ formatWhen(item.modifiedAt) }}</template>
            </span>
          </label>
          <AppButton variant="ghost" :disabled="busy" @click="cloud.openRestore(item.id, item.name)">
            <span class="i-mingcute-history-line size-4" aria-hidden="true" />恢复…
          </AppButton>
        </li>
      </ul>
    </template>
  </div>
</template>
