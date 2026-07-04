<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui';

import type { ProviderView } from '../utils/llm-settings.helpers';

const props = defineProps<{
  providers: ProviderView[];
  selectedProviderId?: string;
}>();

const emit = defineEmits<{
  select: [provider: ProviderView];
}>();
</script>

<template>
  <ScrollAreaRoot class="settings-scroll-root">
    <ScrollAreaViewport class="settings-scroll-viewport">
      <aside class="settings-provider-list" aria-label="供应商列表">
        <button
          v-for="provider in props.providers"
          :key="provider.provider"
          class="settings-provider-card"
          :class="{ 'is-active': props.selectedProviderId === provider.provider }"
          type="button"
          @click="emit('select', provider)"
        >
          <span class="settings-provider-name">{{ provider.providerName }}</span>
          <span class="settings-provider-meta">
            {{ provider.modelCount }} 个模型 · {{ provider.authConfigured ? '已配置凭据' : '未配置凭据' }}
          </span>
        </button>
      </aside>
    </ScrollAreaViewport>
    <ScrollAreaScrollbar class="settings-scrollbar" orientation="vertical">
      <ScrollAreaThumb class="settings-scrollbar-thumb" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
