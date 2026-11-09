<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppNotice } from '@/components/AppNotice';
import { APP_ICON_URL } from '@/utils/app-icon';
import { getDesktopApi } from '@/utils/desktop-api';

import { useDataDirectoryStore } from '../store/data-directory';

const directory = useDataDirectoryStore();
const target = ref('');
const status = computed(() => directory.status);

watch(
  status,
  value => {
    if (value?.kind === 'unset' && !target.value) target.value = value.suggested;
  },
  { immediate: true }
);

async function change() {
  const path = await directory.pick();
  if (path) target.value = path;
}

// 主界面尚未加载，没有需要保存的内容，关闭请求直接放行。
let offClose: (() => void) | undefined;
onMounted(() => {
  offClose = getDesktopApi().windowControl.onCloseRequested(
    () => void getDesktopApi().windowControl.completeClose(true)
  );
});
onBeforeUnmount(() => offClose?.());

function close() {
  void getDesktopApi().windowControl.completeClose(true);
}
</script>

<template>
  <div class="startup">
    <header class="startup-titlebar">
      <img class="startup-icon" :src="APP_ICON_URL" alt="" aria-hidden="true" />
      <span>Chaptale</span>
      <button class="startup-close" type="button" aria-label="关闭窗口" @click="close">
        <span class="i-mingcute-close-line" aria-hidden="true" />
      </button>
    </header>

    <main class="startup-body">
      <form v-if="status?.kind === 'unset'" class="startup-panel" @submit.prevent="directory.choose(target)">
        <h1>选择数据存放位置</h1>
        <p>作品和会话历史都保存在这个文件夹。请选择空文件夹，或已有的 Chaptale 数据文件夹。之后可以在设置里更换。</p>
        <div class="startup-path">
          <AppInput v-model="target" aria-label="数据存放位置" readonly />
          <AppButton type="button" variant="outline" :disabled="directory.busy" @click="change">更改</AppButton>
        </div>
        <AppNotice v-if="directory.error" tone="error">{{ directory.error }}</AppNotice>
        <div class="startup-actions">
          <AppButton type="submit" variant="primary" :disabled="directory.busy || !target">开始使用</AppButton>
        </div>
      </form>

      <section v-else-if="status?.kind === 'unavailable'" class="startup-panel">
        <h1>找不到数据文件夹</h1>
        <p>{{ status.reason }}</p>
        <code class="startup-code">{{ status.path }}</code>
        <AppNotice v-if="directory.error" tone="error">{{ directory.error }}</AppNotice>
        <div class="startup-actions">
          <AppButton variant="outline" :disabled="directory.busy" @click="directory.pickAndChoose()">
            选择其他位置
          </AppButton>
          <AppButton variant="primary" :disabled="directory.busy" @click="directory.load()">重试</AppButton>
        </div>
      </section>

      <section v-else-if="directory.error" class="startup-panel">
        <h1>无法读取数据位置</h1>
        <AppNotice tone="error">{{ directory.error }}</AppNotice>
        <div class="startup-actions">
          <AppButton variant="primary" :disabled="directory.busy" @click="directory.load()">重试</AppButton>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
.startup {
  @apply flex h-screen flex-col bg-background text-foreground;
}

.startup-titlebar {
  @apply flex h-9 shrink-0 select-none items-center gap-2 border-b border-titlebar-border bg-titlebar pl-3 text-xs text-titlebar-foreground;

  -webkit-app-region: drag;
  app-region: drag;
}

.startup-icon {
  width: 18px;
}

.startup-close {
  @apply ml-auto flex-center h-8 w-10 border-0 bg-transparent p-0 text-titlebar-foreground outline-none hover:bg-destructive-background hover:text-destructive-background-foreground;

  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.startup-body {
  @apply flex flex-1 items-center justify-center p-6;
}

.startup-panel {
  @apply flex w-full max-w-lg flex-col gap-4;

  h1 {
    @apply m-0 text-lg font-semibold;
  }

  p {
    @apply m-0 text-sm leading-6;

    color: var(--muted-foreground);
  }
}

.startup-path {
  @apply flex gap-2;

  > :first-child {
    @apply min-w-0 flex-1;
  }
}

.startup-code {
  @apply text-xs;
  overflow-wrap: anywhere;
}

.startup-actions {
  @apply flex justify-end gap-2;
}
</style>
