<script setup lang="ts">
import ActivityBar from '../modules/ActivityBar/index.vue';
import AgentPanel from '../modules/AgentPanel/index.vue';
import SettingsPanel from '../modules/SettingsPanel/index.vue';
import StatusBar from '../modules/StatusBar/index.vue';
import TitleBar from '../modules/TitleBar/index.vue';
</script>

<template>
  <div class="basic-layout">
    <TitleBar />
    <div class="basic-layout-body">
      <ActivityBar />
      <AgentPanel />
    </div>
    <StatusBar />
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
