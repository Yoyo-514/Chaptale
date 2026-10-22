<script setup lang="ts">
import { AppButton } from '@/components/AppButton';

import { useCreationStore } from './store';

const creation = useCreationStore();
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<template>
  <main class="works-library" aria-label="作品库">
    <header class="library-header">
      <h1>作品库</h1>
      <div class="library-actions">
        <AppButton variant="primary" :disabled="!creation.connected" @click="creation.newWorkOpen = true"
          >新建作品</AppButton
        >
      </div>
    </header>
    <div v-if="creation.error" class="library-error" role="alert">
      {{ creation.error }}
      <AppButton size="xs" :disabled="creation.busy" @click="creation.connect()">重新连接</AppButton>
    </div>
    <p v-if="creation.busy && !creation.works.length" class="library-empty" role="status">正在读取作品库…</p>
    <div v-else-if="!creation.works.length && creation.connected" class="library-empty">
      <h2>从一部作品开始</h2>
      <p>新建作品，开始整理文稿与资料。</p>
    </div>
    <div v-else class="library-list">
      <table>
        <thead>
          <tr>
            <th scope="col">作品名称</th>
            <th scope="col">类型</th>
            <th scope="col">最近编辑</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="work in creation.works"
            :key="work.id"
            :aria-disabled="creation.busy"
            @click="!creation.busy && creation.openWork(work.id)"
          >
            <td>
              <button class="work-title" :disabled="creation.busy">
                <span class="i-mingcute-book-2-line" aria-hidden="true" />{{ work.title }}
              </button>
            </td>
            <td>{{ work.kind === 'novel' ? '小说' : '剧本' }}</td>
            <td>
              <time :datetime="new Date(work.updatedAt).toISOString()">{{ date.format(work.updatedAt) }}</time>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </main>
</template>

<style scoped>
.works-library {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--background);
}
.library-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.library-list {
  overflow: auto;
  padding: 8px 32px 32px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}
th {
  color: var(--muted-foreground);
  font-size: 12px;
  font-weight: 500;
  padding: 12px 8px;
}
td {
  padding: 4px 8px;
  border-top: 1px solid var(--border-subtle);
}
td:first-child {
  width: 60%;
}
td:last-child {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--muted-foreground);
}
.work-title {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 0;
  background: none;
  border: 0;
  color: var(--foreground);
  text-align: left;
  font: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.work-title span {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--muted-foreground);
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover,
tbody tr:focus-within {
  background: var(--accent);
}
tbody tr[aria-disabled='true'] {
  cursor: wait;
}
.work-title:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.library-empty {
  margin: 64px auto;
  padding: 0 24px;
  max-width: 65ch;
  color: var(--muted-foreground);
}
.library-empty h2 {
  color: var(--foreground);
  font-size: 16px;
  font-weight: 500;
}
.library-error {
  padding: 12px 32px;
  color: var(--destructive);
}
@media (max-width: 900px) {
  .library-header {
    padding: 16px;
  }
  .library-list {
    padding: 8px 16px;
  }
}
</style>
