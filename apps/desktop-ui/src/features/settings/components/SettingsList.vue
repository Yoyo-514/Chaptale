<template>
  <ul class="settings-list">
    <slot />
  </ul>
</template>

<style lang="scss">
.settings-list {
  @apply m-0 flex list-none flex-col border p-0;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.settings-list > li + li {
  border-top: 1px solid var(--border-subtle);
}
</style>
