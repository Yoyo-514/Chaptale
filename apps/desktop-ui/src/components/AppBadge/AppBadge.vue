<template>
  <span class="app-badge"><slot /></span>
</template>

<style lang="scss">
.app-badge {
  @apply inline-flex shrink-0 items-center border px-1.5 leading-4;

  background: var(--secondary);
  border-color: var(--border-subtle);
  border-radius: var(--radius-badge);
  color: var(--secondary-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 400;
  white-space: nowrap;
}
</style>
