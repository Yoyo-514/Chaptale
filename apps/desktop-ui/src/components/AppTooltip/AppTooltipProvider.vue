<script setup lang="ts">
import { TooltipProvider } from 'reka-ui';

import { TOOLTIP_DELAY_DURATION_MS, TOOLTIP_SKIP_DELAY_DURATION_MS } from './constants';
</script>

<template>
  <TooltipProvider :delay-duration="TOOLTIP_DELAY_DURATION_MS" :skip-delay-duration="TOOLTIP_SKIP_DELAY_DURATION_MS">
    <slot />
  </TooltipProvider>
</template>
