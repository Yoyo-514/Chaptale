<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useSettlementStore } from '@/features/settlement';
import { useTemplateStore } from '@/features/templates';
import { useVersionStore } from '@/features/versions';
import { getDesktopApi, hasDesktopApi } from '@/utils/desktop-api';

import { assetKindLabel, isUnclassified, relations } from '../presentation';
import { useAssetStore } from '../store';

const assets = useAssetStore();
const editor = useEditorStore();
const library = useLibraryStore();
const templates = useTemplateStore();
const settlement = useSettlementStore();
const versions = useVersionStore();
const templateId = ref('character-main');
const outgoing = computed(() => (assets.current ? relations(assets.current) : []));
const incoming = computed(() =>
  library.assets.flatMap(asset =>
    relations(asset).flatMap(relation =>
      relation.link?.targetPath === assets.current?.sourcePath ? [{ source: asset, ...relation }] : []
    )
  )
);
const backrefs = computed(() => library.assets.filter(asset => assets.current?.backlinks.includes(asset.sourcePath)));
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void assets.refresh();
  void templates.load();
  if (hasDesktopApi()) unsubscribe = getDesktopApi().memory?.onPendingChanged?.(() => void assets.refresh());
});
onBeforeUnmount(() => unsubscribe?.());
</script>
<template>
  <section class="asset-panel" aria-label="资产详情">
    <header>
      <h2>{{ assets.current?.title ?? '资产详情' }}</h2>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="查看文档版本"
        :disabled="!editor.activeTab?.document"
        @click="versions.open()"
        ><span class="i-mingcute-history-line"
      /></AppButton>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="刷新资产详情"
        :disabled="library.loading"
        @click="assets.refresh"
        ><span class="i-mingcute-refresh-3-line"
      /></AppButton>
    </header>
    <AppScrollArea class="asset-scroll">
      <p v-if="assets.error || versions.error" class="asset-error" role="alert">{{ assets.error || versions.error }}</p>
      <div v-if="assets.current" class="asset-content">
        <p class="asset-path">{{ assets.current.sourcePath }}</p>
        <section v-if="isUnclassified(assets.current)" class="asset-section">
          <h3>未分类</h3>
          <p v-if="assets.current.diagnostic" class="asset-error">{{ assets.current.diagnostic }}</p>
          <AppSelect v-model="templateId" aria-label="识别模板">
            <AppSelectItem v-for="item in templates.templates" :key="item.template" :value="item.template">{{
              item.name
            }}</AppSelectItem>
          </AppSelect>
          <AppButton
            :disabled="assets.busy || Boolean(assets.current.diagnostic) || editor.activeTab?.dirty"
            @click="assets.identify(templateId)"
            >识别文档</AppButton
          >
        </section>
        <section class="asset-section">
          <h3>
            待确认事实 <span>{{ assets.currentProposals.length + assets.currentBatches.length }}</span>
          </h3>
          <p v-if="!assets.currentProposals.length && !assets.currentBatches.length" class="asset-empty">
            没有待确认提议
          </p>
          <AppButton
            v-for="batch in assets.currentBatches"
            :key="batch.id"
            variant="ghost"
            class="asset-link"
            @click="settlement.read(batch.id, assets.current?.sourcePath)"
            ><span class="i-mingcute-document-line" />{{ batch.chapterTitle }} · {{ batch.pending }} 项待确认</AppButton
          >
          <AppButton
            v-for="proposal in assets.currentProposals"
            :key="proposal.id"
            variant="ghost"
            class="asset-link"
            @click="assets.inspect(proposal.id)"
            ><span class="i-mingcute-document-line" />{{ proposal.title }}</AppButton
          >
        </section>
        <section v-if="outgoing.length || incoming.length" class="asset-section">
          <h3>人物关系</h3>
          <div v-for="(relation, index) in outgoing" :key="`out-${index}`" class="asset-relation">
            <AppButton v-if="relation.link?.targetPath" variant="link" @click="assets.open(relation.link.targetPath)">{{
              relation.to
            }}</AppButton>
            <span v-else class="asset-warning">{{ relation.to }}</span>
            <span>{{ relation.type }}</span>
            <p v-if="relation.note">{{ relation.note }}</p>
          </div>
          <div v-for="(relation, index) in incoming" :key="`in-${index}`" class="asset-relation">
            <AppButton variant="link" @click="assets.open(relation.source.sourcePath)">{{
              relation.source.title
            }}</AppButton>
            <span>将本角色视为{{ relation.type }}</span>
            <p v-if="relation.note">{{ relation.note }}</p>
          </div>
        </section>
        <section class="asset-section">
          <h3>
            双链 <span>{{ assets.current.links.length }}</span>
          </h3>
          <p v-if="!assets.current.links.length" class="asset-empty">没有出向引用</p>
          <div v-for="link in assets.current.links" :key="link.link" class="asset-reference">
            <AppButton v-if="link.targetPath" variant="link" class="asset-link" @click="assets.open(link.targetPath)"
              >{{ link.link
              }}<span v-if="link.status === 'moved'" class="i-mingcute-transfer-line" aria-label="来源已移动"
            /></AppButton>
            <template v-else>
              <span class="asset-warning"
                ><span class="i-mingcute-warning-line" /> {{ link.link }} ·
                {{ link.status === 'ambiguous' ? '重名' : '断链' }}</span
              >
              <AppButton
                v-for="candidate in link.candidates"
                :key="candidate"
                variant="link"
                class="asset-link"
                @click="assets.open(candidate)"
                >{{ candidate }}</AppButton
              >
            </template>
          </div>
        </section>
        <section class="asset-section">
          <h3>
            反向引用 <span>{{ backrefs.length }}</span>
          </h3>
          <p v-if="!backrefs.length" class="asset-empty">没有反向引用</p>
          <AppButton
            v-for="source in backrefs"
            :key="source.sourcePath"
            variant="link"
            class="asset-link"
            :title="source.sourcePath"
            @click="assets.open(source.sourcePath)"
            >{{ source.title }}<span class="asset-kind">{{ assetKindLabel(source.kind) }}</span></AppButton
          >
        </section>
      </div>
      <p v-else class="asset-empty asset-no-document">尚未选择已索引文档</p>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.asset-panel {
  @apply flex h-full min-h-0 min-w-0 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex min-h-9 shrink-0 items-center gap-1 border-b px-3;
  border-color: var(--border-subtle);
}
h2 {
  @apply m-0 min-w-0 flex-1 break-words font-medium;
  font-size: var(--ui-font-size);
}
.asset-scroll {
  @apply min-h-0 flex-1;
}
.asset-content {
  @apply flex flex-col px-3;
}
.asset-path {
  @apply m-0 py-3;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.asset-section {
  @apply flex flex-col gap-2 border-t py-3;
  border-color: var(--border-subtle);
}
h3 {
  @apply m-0 mb-1 flex items-center justify-between gap-2 font-medium;
  font-size: var(--ui-font-size);
}
h3 span,
.asset-kind {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 400;
}
.asset-link {
  @apply min-w-0 justify-start p-1 text-left;
}
.asset-relation {
  @apply flex flex-wrap items-center gap-x-2 gap-y-1;
}
.asset-relation p {
  @apply m-0 w-full;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
.asset-reference {
  @apply flex flex-col items-start gap-1;
  overflow-wrap: anywhere;
}
.asset-warning {
  color: var(--warning);
}
.asset-error {
  @apply m-0 p-3;
  color: var(--destructive);
  overflow-wrap: anywhere;
}
.asset-empty {
  @apply m-0;
  color: var(--muted-foreground);
}
.asset-no-document {
  @apply p-3;
}
</style>
