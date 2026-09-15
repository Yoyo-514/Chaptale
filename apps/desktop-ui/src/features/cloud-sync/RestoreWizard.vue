<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';

import RestoreConflicts from './components/RestoreConflicts.vue';
import RestorePlan from './components/RestorePlan.vue';
import RestoreReceipt from './components/RestoreReceipt.vue';
import { useCloudSyncStore } from './store';

const cloud = useCloudSyncStore();
const wizard = computed(() => cloud.wizard);
const confirmLabel = computed(() => {
  if (cloud.isApplying) return '正在恢复…';
  if (wizard.value?.mode === 'new') return '解包到新目录';
  if (wizard.value?.mode === 'overwrite') return '原地覆盖（先留快照）';
  return '按选择写入';
});
</script>

<template>
  <AppDialog
    :open="Boolean(wizard) || cloud.isPlanLoading"
    title="恢复云端备份"
    content-size="lg"
    :description="wizard ? `归档：${wizard.archiveName}` : undefined"
    :show-close="!cloud.isApplying"
    @escape-key-down="cloud.isApplying && $event.preventDefault()"
    @interact-outside="cloud.isApplying && $event.preventDefault()"
    @update:open="open => !open && cloud.closeRestore()"
  >
    <div class="restore">
      <AppScrollArea class="restore-scroll">
        <div class="restore-content">
          <p v-if="cloud.isPlanLoading" class="restore-note" role="status">
            <span class="i-mingcute-refresh-3-line size-4 shrink-0 animate-spin" aria-hidden="true" />
            正在读取归档并与当前作品比对…
          </p>
          <template v-else-if="wizard">
            <RestoreReceipt v-if="wizard.receipt" :receipt="wizard.receipt" />
            <template v-else>
              <RestorePlan :wizard="wizard" />
              <RestoreConflicts v-if="wizard.mode === 'merge'" :wizard="wizard" />
            </template>
          </template>
          <p v-if="cloud.backupError" class="restore-note is-blocked" role="alert">
            <span class="i-mingcute-warning-line size-4 shrink-0" aria-hidden="true" />{{ cloud.backupError }}
          </p>
        </div>
      </AppScrollArea>
      <footer class="restore-footer">
        <AppButton variant="ghost" :disabled="cloud.isApplying" @click="cloud.closeRestore()">
          {{ wizard?.receipt ? '关闭' : '取消' }}
        </AppButton>
        <AppButton
          v-if="wizard && !wizard.receipt"
          variant="primary"
          :disabled="cloud.isApplying || Boolean(cloud.restoreBlockedReason)"
          @click="cloud.applyRestore()"
        >
          {{ confirmLabel }}
        </AppButton>
      </footer>
    </div>
  </AppDialog>
</template>

<style lang="scss">
@use './styles/restore';
</style>
