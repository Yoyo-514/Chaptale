<script setup lang="ts">
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport
} from 'reka-ui';
import { computed, inject, useAttrs } from 'vue';

import { AppButton } from '@/components/AppButton';
import { useOverlayLayer } from '@/composables';
import { cn } from '@/utils';

import { appFormContextKey } from '../AppForm/context';

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    options: Array<{ value: string; label: string; description?: string }>;
    disabled?: boolean;
    invalid?: boolean;
    placeholder?: string;
  }>(),
  { modelValue: '', disabled: false, invalid: false, placeholder: undefined }
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const attrs = useAttrs();
const form = inject(appFormContextKey, undefined);
const disabled = computed(() => props.disabled || form?.disabled.value === true);
const invalid = computed(() => props.invalid || attrs['aria-invalid'] === 'true');
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});
const layer = useOverlayLayer();
const options = computed(() => {
  if (props.options.some(option => option.value === props.modelValue)) return props.options;
  const query = props.modelValue.toLocaleLowerCase().replace(/^\[\[|\]\]$/g, '');
  return props.options.filter(option =>
    `${option.label} ${option.value} ${option.description ?? ''}`.toLocaleLowerCase().includes(query)
  );
});
</script>
<template>
  <ComboboxRoot
    :model-value="modelValue"
    :disabled="disabled"
    ignore-filter
    open-on-click
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    @update:model-value="emit('update:modelValue', String($event ?? ''))"
  >
    <ComboboxAnchor
      :class="cn('app-combobox-anchor', attrs.class)"
      :style="attrs.style"
      :data-disabled="disabled || undefined"
      :data-invalid="invalid || undefined"
      data-slot="app-combobox"
    >
      <ComboboxInput
        v-bind="inputAttrs"
        :model-value="modelValue"
        :disabled="disabled"
        :aria-invalid="invalid ? 'true' : undefined"
        :placeholder="placeholder"
        class="app-combobox-input"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <ComboboxTrigger as-child>
        <AppButton
          icon
          size="xs"
          variant="ghost"
          tabindex="-1"
          :disabled="disabled"
          aria-label="显示选项"
          title="显示选项"
        >
          <span class="i-mingcute-down-line size-4" aria-hidden="true" />
        </AppButton>
      </ComboboxTrigger>
    </ComboboxAnchor>
    <ComboboxPortal>
      <ComboboxContent
        class="app-combobox-content"
        position="popper"
        :side-offset="6"
        :style="{ zIndex: `var(--z-${layer})` }"
      >
        <ComboboxViewport class="app-combobox-viewport">
          <ComboboxEmpty class="app-combobox-empty">无匹配来源</ComboboxEmpty>
          <ComboboxItem v-for="option in options" :key="option.value" :value="option.value" class="app-combobox-item">
            <span class="app-combobox-copy"
              ><span>{{ option.label }}</span
              ><small v-if="option.description">{{ option.description }}</small></span
            >
            <ComboboxItemIndicator
              ><span class="i-mingcute-check-line size-4" aria-hidden="true"
            /></ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
<style lang="scss">
.app-combobox-anchor {
  @apply flex min-w-0 items-center gap-1 border pl-3 pr-0.5;
  min-height: var(--control-height-sm);
  border-color: var(--input-border);
  border-radius: var(--radius-control);
  background: var(--input);
  color: var(--foreground);
}
.app-combobox-anchor:focus-within {
  box-shadow: var(--input-focus-shadow);
}
.app-combobox-anchor[data-disabled] {
  opacity: 0.6;
}
.app-combobox-anchor[data-invalid] {
  border-color: var(--destructive);
}
.app-combobox-input {
  @apply w-full min-w-0 flex-1 border-0 bg-transparent py-1.5 outline-none;
  font-size: var(--ui-font-size);
  line-height: 18px;
  color: inherit;
}
.app-combobox-input::placeholder {
  color: var(--muted-foreground);
}
.app-combobox-content {
  @apply border p-1 shadow-$shadow-float;
  width: var(--reka-combobox-trigger-width);
  max-width: calc(100vw - 24px);
  background: var(--popover);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
  color: var(--foreground);
}
.app-combobox-viewport {
  max-height: min(var(--reka-combobox-content-available-height, 16rem), 16rem);
  overflow: auto;
}
.app-combobox-item {
  @apply flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 outline-none;
  font-size: var(--ui-font-size);
}
.app-combobox-item[data-highlighted] {
  background: var(--surface-hover);
}
.app-combobox-copy {
  @apply flex min-w-0 flex-col gap-1;
  overflow-wrap: anywhere;
}
.app-combobox-copy small {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.app-combobox-empty {
  @apply px-2 py-3;
  font-size: var(--ui-font-size);
  color: var(--muted-foreground);
}
</style>
