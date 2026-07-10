<script setup lang="ts">
import { AppTooltipProvider } from '../components/AppTooltip';
import BasicLayout from '../layouts/BasicLayout.vue';
import NotificationCenter from '../modules/NotificationCenter/index.vue';
</script>

<template>
  <AppTooltipProvider>
    <BasicLayout />
    <NotificationCenter />
  </AppTooltipProvider>
</template>
