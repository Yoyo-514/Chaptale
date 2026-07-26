<script setup lang="ts">
import { NotificationCenter } from '@/features/notifications';

import { AppTooltipProvider } from '../components/AppTooltip';
import BasicLayout from '../layouts/BasicLayout.vue';
</script>

<template>
  <AppTooltipProvider>
    <BasicLayout />
    <NotificationCenter />
  </AppTooltipProvider>
</template>
