<script setup lang="ts">
import { computed } from 'vue';

import { CLOUD_PROVIDER_LABELS, type CloudProvider } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';

import { useCloudSyncStore } from '../store';

const cloud = useCloudSyncStore();
const providerNotes: Record<CloudProvider, string> = {
  dropbox: '应用专属目录 /Apps/Chaptale/：只读写这一块，看不到你云盘里的其他文件。',
  onedrive: '应用专属文件夹：只读写这一块，看不到你云盘里的其他文件。'
};
const providers = computed(() =>
  cloud.availability.map(item => ({
    provider: item.provider,
    configured: item.configured,
    label: CLOUD_PROVIDER_LABELS[item.provider],
    note: providerNotes[item.provider],
    account: cloud.accounts.find(account => account.provider === item.provider) ?? null
  }))
);
</script>

<template>
  <section class="cloud-section" aria-labelledby="cloud-accounts-title">
    <div class="cloud-heading">
      <h4 id="cloud-accounts-title">账户</h4>
      <AppButton icon variant="ghost" aria-label="刷新云端账户" :disabled="cloud.isLoading" @click="cloud.load()">
        <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />
      </AppButton>
    </div>
    <p v-if="cloud.isLoading && !cloud.state" class="cloud-muted" role="status">正在读取登录状态…</p>
    <ul v-else class="cloud-providers">
      <li v-for="item in providers" :key="item.provider" class="cloud-provider">
        <div class="cloud-provider-copy">
          <div class="cloud-provider-title">
            <strong>{{ item.label }}</strong>
            <span v-if="item.account" class="cloud-state is-online">
              <span class="i-mingcute-check-line size-3.5" aria-hidden="true" />{{ item.account.displayName }}
            </span>
            <span v-else class="cloud-state">{{ item.configured ? '未登录' : '未配置' }}</span>
          </div>
          <p class="cloud-muted">{{ item.note }}</p>
        </div>
        <div class="cloud-actions">
          <AppButton
            v-if="item.account"
            variant="ghost"
            :disabled="cloud.busy !== null"
            @click="cloud.signOut(item.provider)"
          >
            退出登录
          </AppButton>
          <AppButton v-else-if="item.configured" :disabled="cloud.busy !== null" @click="cloud.signIn(item.provider)">
            <span class="i-mingcute-lock-line size-4" aria-hidden="true" />登录
          </AppButton>
          <AppButton v-if="item.account" variant="ghost" @click="cloud.openFolder(item.provider, null)">
            <span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true" />云端目录
          </AppButton>
        </div>
      </li>
    </ul>
    <p v-if="cloud.busy" class="cloud-pending" role="status">
      <span>正在处理 {{ CLOUD_PROVIDER_LABELS[cloud.busy] }} 账户…</span>
      <AppButton variant="ghost" @click="cloud.cancelSignIn()">取消授权</AppButton>
    </p>
    <p v-if="cloud.error" class="cloud-error" role="alert">{{ cloud.error }}</p>
  </section>
</template>
