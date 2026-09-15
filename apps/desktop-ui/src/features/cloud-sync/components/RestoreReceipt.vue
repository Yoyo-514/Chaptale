<script setup lang="ts">
import type { CloudRestoreResult } from '@chaptale/ipc-contract';

defineProps<{ receipt: CloudRestoreResult & { ok: true } }>();
</script>

<template>
  <section class="restore-block restore-receipt" aria-labelledby="restore-receipt-title">
    <h4 id="restore-receipt-title" class="restore-heading">
      <span class="i-mingcute-check-circle-line size-4" aria-hidden="true" />已恢复
    </h4>
    <dl class="restore-facts">
      <div>
        <dt>位置</dt>
        <dd>{{ receipt.targetPath }}</dd>
      </div>
      <div>
        <dt>写入</dt>
        <dd>{{ receipt.written }} 个文件</dd>
      </div>
      <div v-if="receipt.snapshotId">
        <dt>还原前快照</dt>
        <dd>{{ receipt.snapshotId }}</dd>
      </div>
      <div v-if="receipt.skipped.length">
        <dt>未写入</dt>
        <dd>{{ receipt.skipped.map(item => item.relativePath).join('、') }}</dd>
      </div>
    </dl>
    <p class="restore-note">
      <span class="i-mingcute-information-line size-4 shrink-0" aria-hidden="true" />
      <span>
        <template v-if="receipt.snapshotId">覆盖前的内容保存在缓存目录的 restore-guard 中。</template>
        <template v-if="receipt.mode === 'new'">当前作品未改动，新目录还没有云端绑定。</template>
        <template v-else>已打开的干净文件会重新读盘，未保存的缓冲不会被覆盖。</template>
      </span>
    </p>
  </section>
</template>
