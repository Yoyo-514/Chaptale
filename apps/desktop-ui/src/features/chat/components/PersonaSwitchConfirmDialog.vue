<script setup lang="ts">
import { AppAlertDialog } from '@/components/AppDialog';

const props = defineProps<{
  open: boolean;
  /** 目标专员名：把「换到谁」说清楚，比抽象的「切换」更让人明白这一步的后果。 */
  personaName: string;
}>();

const emit = defineEmits<{
  'update:open': [open: boolean];
  confirm: [];
}>();
</script>

<template>
  <AppAlertDialog
    :open="props.open"
    title="切换专员会新建一个会话"
    :description="`当前会话已有消息，它会留在历史里；「${props.personaName}」会从新会话开始。`"
    confirm-label="切换并新建会话"
    @update:open="emit('update:open', $event)"
    @confirm="emit('confirm')"
  />
</template>
