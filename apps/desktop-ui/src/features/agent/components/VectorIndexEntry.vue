<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, ref, watch } from 'vue';

import type { EmbeddingSettingsView } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppTooltip } from '@/components/AppTooltip';
import { useSettingsStore } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useVectorIndexStore } from '../vector-index';

const props = defineProps<{ workId: string }>();
const index = useVectorIndexStore();
const settings = useSettingsStore();
const numbers = new Intl.NumberFormat('zh-CN');

const open = ref(false);
const service = ref<EmbeddingSettingsView | null>(null);
/** 作者点了建立或重建，弹层里正在展示要发送的内容，等作者确认。 */
const confirming = ref<'build' | 'rebuild'>();
const busy = ref(false);
const error = ref('');

const status = computed(() => index.statuses[props.workId]);
const percent = computed(() => {
  const running = status.value?.running;
  return running ? Math.floor((running.done / running.total) * 100) : undefined;
});
const destination = computed(() =>
  service.value ? `${new URL(service.value.baseUrl).host}（${service.value.model}）` : ''
);
const summary = computed(() => {
  const current = status.value;
  if (!current) return '';
  if (current.state === 'unconfigured') return '还没有设置检索服务。设置好以后，可以为这部作品建立索引。';
  if (current.state === 'none') return '这部作品还没有建立索引，助手现在只能按关键词查找。';
  if (current.state === 'stale') return '索引是用另一个模型或向量维度建立的，重建后才能使用。';
  if (current.total === 0) return '这部作品还没有可以索引的内容。';
  if (current.indexed < current.total)
    return `已索引 ${numbers.format(current.indexed)} / ${numbers.format(current.total)} 段。没算的段落会在助手检索时补上，也可以现在接着建立。`;
  return `已索引全部 ${numbers.format(current.total)} 段。`;
});
const sending = computed(() => {
  const current = status.value;
  if (!current || !confirming.value) return '';
  const [segments, characters] =
    confirming.value === 'rebuild'
      ? [current.total, current.characters]
      : [current.total - current.indexed, current.pendingCharacters];
  const lead = confirming.value === 'rebuild' ? '重建会清空已有索引，把全部' : '将把';
  return `${lead} ${numbers.format(segments)} 段、约 ${numbers.format(characters)} 字发送到 ${destination.value} 计算向量。可以随时停止，算好的部分会保留。`;
});

async function load() {
  error.value = '';
  try {
    const [saved] = await Promise.all([
      getDesktopApi().agentHost.request('embeddingSettings', undefined),
      index.refresh(props.workId)
    ]);
    service.value = saved;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
// 挂载时读取一次，重新进入界面后图标仍能显示正在进行的建立。
watch(() => props.workId, load, { immediate: true });
watch(open, value => {
  confirming.value = undefined;
  if (value) void load();
});

async function act(action: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}

function start() {
  const rebuild = confirming.value === 'rebuild';
  confirming.value = undefined;
  return act(() => index.build(props.workId, rebuild));
}

function openSettings() {
  open.value = false;
  settings.openPanel('retrieval');
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <AppTooltip text="语义检索索引">
        <AppButton
          class="vector-index-trigger"
          type="button"
          size="xs"
          variant="ghost"
          :icon="percent === undefined"
          aria-label="语义检索索引"
        >
          <span class="i-mingcute-database-search-line size-3.5" aria-hidden="true" />
          <span v-if="percent !== undefined">{{ percent }}%</span>
        </AppButton>
      </AppTooltip>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="vector-index-popover" side="top" align="start" :side-offset="6">
        <h3>语义检索索引</h3>
        <p v-if="!status && !error">正在读取…</p>
        <template v-else-if="status?.running">
          <p role="status">
            正在建立：{{ numbers.format(status.running.done) }} / {{ numbers.format(status.running.total) }} 段
          </p>
          <progress :value="status.running.done" :max="status.running.total" aria-label="建立进度" />
          <div class="vector-index-actions">
            <AppButton size="xs" :disabled="busy" @click="act(() => index.cancel(workId))">停止</AppButton>
          </div>
        </template>
        <template v-else-if="status && confirming">
          <p>{{ sending }}</p>
          <div class="vector-index-actions">
            <AppButton size="xs" @click="confirming = undefined">取消</AppButton>
            <AppButton size="xs" variant="primary" @click="start">{{
              confirming === 'rebuild' ? '开始重建' : '开始建立'
            }}</AppButton>
          </div>
        </template>
        <template v-else-if="status">
          <p>{{ summary }}</p>
          <p v-if="status.error" role="alert" class="agent-error">上次建立没有完成：{{ status.error }}</p>
          <div v-if="status.state !== 'unconfigured' && status.total > 0" class="vector-index-actions">
            <AppButton v-if="status.state === 'ready'" size="xs" :disabled="busy" @click="confirming = 'rebuild'"
              >重建索引</AppButton
            >
            <AppButton
              v-if="status.state !== 'ready' || status.indexed < status.total"
              size="xs"
              variant="primary"
              :disabled="busy"
              @click="confirming = status.state === 'stale' ? 'rebuild' : 'build'"
              >{{
                status.state === 'stale' ? '重建索引' : status.state === 'none' ? '建立索引' : '继续建立'
              }}</AppButton
            >
          </div>
        </template>
        <p v-if="error" role="alert" class="agent-error">{{ error }}</p>
        <footer>
          <span v-if="service">{{ destination }}</span>
          <AppButton size="xs" variant="ghost" @click="openSettings">检索设置</AppButton>
        </footer>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style lang="scss">
.vector-index-trigger {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
.vector-index-popover {
  z-index: var(--z-popover);
  display: flex;
  width: 20rem;
  max-width: calc(100vw - 24px);
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-control);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: var(--shadow-float);
  font-size: var(--ui-font-size);
  line-height: 1.6;
  h3 {
    margin: 0;
    font-size: var(--ui-font-size);
    font-weight: 600;
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  progress {
    width: 100%;
    height: 4px;
    accent-color: var(--primary);
  }
  footer {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
    color: var(--muted-foreground);
    font-size: var(--ui-caption-size);
  }
  footer > span {
    overflow: hidden;
    min-width: 0;
    margin-right: auto;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.vector-index-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
