<script setup lang="ts">
import { TooltipProvider } from 'reka-ui';

import { TOOLTIP_DELAY_DURATION_MS, TOOLTIP_SKIP_DELAY_DURATION_MS } from './constants';
</script>

<template>
  <!-- 菜单、弹窗用鼠标关闭后焦点会回到触发按钮；只有键盘聚焦才弹提示。 -->
  <TooltipProvider
    :delay-duration="TOOLTIP_DELAY_DURATION_MS"
    :skip-delay-duration="TOOLTIP_SKIP_DELAY_DURATION_MS"
    ignore-non-keyboard-focus
  >
    <slot />
  </TooltipProvider>
</template>
