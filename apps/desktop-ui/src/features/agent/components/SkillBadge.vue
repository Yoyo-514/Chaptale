<script setup lang="ts">
defineProps<{ name: string }>();
</script>

<template>
  <span class="agent-skill-badge" :title="`调用技能 ${name}`">
    <span class="i-mingcute-sparkles-line size-3.5 shrink-0" aria-hidden="true" />
    <span>/skill:{{ name }}</span>
  </span>
</template>
