<script setup lang="ts">
import { CLOUD_PROVIDER_LABELS } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';

import { useCloudSyncStore } from '../store';

const cloud = useCloudSyncStore();
function browse(parentId: string | null) {
  if (cloud.browseProvider) void cloud.openFolder(cloud.browseProvider, parentId);
}
function bindHere() {
  if (cloud.browseProvider && cloud.listing) {
    void cloud.bind(cloud.browseProvider, cloud.listing.current.id, cloud.listing.current.name);
  }
}
</script>

<template>
  <section v-if="cloud.browseProvider" class="cloud-section" aria-labelledby="cloud-browser-title">
    <div class="cloud-heading">
      <h4 id="cloud-browser-title">云端目录 · {{ CLOUD_PROVIDER_LABELS[cloud.browseProvider] }}</h4>
      <div class="cloud-actions">
        <AppButton
          v-if="cloud.listing && !cloud.listing.current.root"
          icon
          variant="ghost"
          aria-label="上一级云端目录"
          @click="browse(cloud.listing.parentId)"
        >
          <span class="i-mingcute-arrow-left-line size-4" aria-hidden="true" />
        </AppButton>
        <AppButton
          icon
          variant="ghost"
          aria-label="刷新云端目录"
          :disabled="cloud.isListingLoading"
          @click="browse(cloud.listing?.current.id ?? null)"
        >
          <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />
        </AppButton>
        <AppButton icon variant="ghost" aria-label="收起云端目录" @click="cloud.closeFolder()">
          <span class="i-mingcute-close-line size-4" aria-hidden="true" />
        </AppButton>
      </div>
    </div>
    <p v-if="cloud.isListingLoading" class="cloud-muted" role="status">正在读取云端目录…</p>
    <template v-else-if="cloud.listing">
      <p class="cloud-path">
        {{ cloud.listing.current.name }}
        <span v-if="cloud.listing.current.root" class="cloud-muted">· 应用最顶层</span>
      </p>
      <p v-if="!cloud.listing.folders.length" class="cloud-muted">这个目录下还没有子目录。</p>
      <ul v-else class="cloud-providers">
        <li v-for="folder in cloud.listing.folders" :key="folder.id ?? folder.name">
          <AppButton variant="ghost" class="cloud-folder" @click="browse(folder.id)">
            <span class="i-mingcute-folder-2-line size-4 shrink-0" aria-hidden="true" />{{ folder.name }}
          </AppButton>
        </li>
      </ul>
      <div class="cloud-actions is-end">
        <AppButton :disabled="cloud.isBackupLoading || cloud.isApplying || cloud.isBackupRunning" @click="bindHere">
          <span class="i-mingcute-check-line size-4" aria-hidden="true" />用作备份位置
        </AppButton>
      </div>
    </template>
    <p v-if="cloud.listingError" class="cloud-error" role="alert">{{ cloud.listingError }}</p>
  </section>
</template>
