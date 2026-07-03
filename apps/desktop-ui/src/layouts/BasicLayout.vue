<script setup lang="ts">
import { RouterView } from 'vue-router';

import TitleBar from '../components/TitleBar/TitleBar.vue';
</script>

<template>
  <div class="basic-layout">
    <TitleBar />
    <RouterView />
  </div>
</template>

<style scoped lang="scss">
.basic-layout {
  @apply relative flex h-full flex-col overflow-hidden;
}
</style>
