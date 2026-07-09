<script setup lang="ts">
import AppTooltipProvider from '../components/AppTooltip/AppTooltipProvider.vue';
import NotificationCenter from '../modules/NotificationCenter/index.vue';
import BasicLayout from '../layouts/BasicLayout.vue';
</script>

<template>
  <AppTooltipProvider>
    <BasicLayout />
    <NotificationCenter />
  </AppTooltipProvider>
</template>
