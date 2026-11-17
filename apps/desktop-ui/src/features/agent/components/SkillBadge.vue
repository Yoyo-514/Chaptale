<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <span class="agent-skill-badge" :title="`调用技能 ${name}`">
    <span class="i-mingcute-sparkles-line size-3.5 shrink-0" aria-hidden="true" />
    <span>/skill:{{ name }}</span>
  </span>
</template>

<style lang="scss">
.agent-skill-badge {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--secondary);
  color: var(--secondary-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 500;
  line-height: 1.4;
}
.agent-skill-badge > span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
