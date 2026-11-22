<script setup lang="ts">
import { DropdownMenuSeparator } from 'reka-ui';
</script>

<template>
  <DropdownMenuSeparator class="app-dropdown-separator" data-slot="app-dropdown-menu-separator" />
</template>

<style scoped lang="scss">
.app-dropdown-separator {
  @apply my-1 h-px;
  background: var(--border-subtle);
}
</style>
