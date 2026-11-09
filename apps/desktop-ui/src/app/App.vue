<script setup lang="ts">
import { NotificationCenter } from '@/features/notifications';
import { DataDirectoryStartup, useDataDirectoryStore } from '@/features/settings';
import { hasDesktopApi } from '@/utils/desktop-api';

import { AppTooltipProvider } from '../components/AppTooltip';
import BasicLayout from '../layouts/BasicLayout.vue';

// 数据目录就绪之前不加载工作台：工作台一挂载就会连接应用宿主读取作品与会话。
const directory = useDataDirectoryStore();
const desktop = hasDesktopApi();
if (desktop) void directory.load();
</script>

<template>
  <AppTooltipProvider>
    <BasicLayout v-if="!desktop || directory.ready" />
    <DataDirectoryStartup v-else-if="directory.status || directory.error" />
    <NotificationCenter />
  </AppTooltipProvider>
</template>
