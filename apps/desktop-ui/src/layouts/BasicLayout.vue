<script setup lang="ts">
import { RouterView } from 'vue-router';

import ActivityBar from '../components/ActivityBar/ActivityBar.vue';
import SettingsPanel from '../components/SettingsPanel/SettingsPanel.vue';
import TitleBar from '../components/TitleBar/TitleBar.vue';
</script>

<template>
  <div class="basic-layout">
    <TitleBar />
    <div class="basic-layout-body">
      <ActivityBar />
      <RouterView />
    </div>
    <SettingsPanel />
  </div>
</template>

<style scoped lang="scss">
.basic-layout {
  @apply relative flex h-full flex-col overflow-hidden;
}

.basic-layout-body {
  @apply flex min-h-0 flex-1 overflow-hidden;
}
</style>
