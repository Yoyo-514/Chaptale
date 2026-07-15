<script setup lang="ts">
import {
  injectTooltipProviderContext,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger
} from 'reka-ui';
import { defineComponent, useAttrs } from 'vue';

import { TOOLTIP_DELAY_DURATION_MS, TOOLTIP_SKIP_DELAY_DURATION_MS } from './constants';

defineOptions({
  inheritAttrs: false
});

withDefaults(
  defineProps<{
    text: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    withArrow?: boolean;
  }>(),
  {
    side: 'top',
    align: 'center',
    sideOffset: 4,
    withArrow: false
  }
);

const attrs = useAttrs();

const PassThrough = defineComponent({
  name: 'AppTooltipPassThrough',
  setup(_, { slots }) {
    return () => slots.default?.();
  }
});

// 优先复用应用级 TooltipProvider（共享“快速连续悬停跳过延迟”状态）；
// 独立挂载（如组件单测）时回退到本地 Provider，保证组件可独立工作。
const hasSharedProvider = injectTooltipProviderContext(null) !== null;
const ProviderComponent = hasSharedProvider ? PassThrough : TooltipProvider;
const providerProps = hasSharedProvider
  ? {}
  : { delayDuration: TOOLTIP_DELAY_DURATION_MS, skipDelayDuration: TOOLTIP_SKIP_DELAY_DURATION_MS };
</script>

<template>
  <component :is="ProviderComponent" v-bind="providerProps">
    <TooltipRoot>
      <TooltipTrigger v-bind="attrs" as-child data-slot="app-tooltip-trigger">
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="app-tooltip"
          :side="side"
          :align="align"
          :side-offset="sideOffset"
          data-slot="app-tooltip-content"
        >
          {{ text }}
          <TooltipArrow
            v-if="withArrow"
            class="app-tooltip-arrow"
            :width="10"
            :height="5"
            data-slot="app-tooltip-arrow"
          />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </component>
</template>

<style lang="scss">
.app-tooltip {
  @apply z-$z-tooltip border px-2 py-1 text-xs shadow-$shadow-soft;

  background: var(--popover);
  border-color: var(--border);
  color: var(--popover-foreground);
  backdrop-filter: var(--blur-acrylic-subtle);
}

.app-tooltip-arrow {
  fill: var(--popover);
  stroke: var(--border);
  stroke-width: 1px;
}
</style>
