<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
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
const pendingCount = computed(() => assets.currentProposals.length + assets.currentBatches.length);
const subtitle = computed(() =>
  assets.current ? `${assetKindLabel(assets.current.kind)} · ${assets.current.sourcePath}` : undefined
);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void assets.refresh();
  void templates.load();
  if (hasDesktopApi()) unsubscribe = getDesktopApi().memory?.onPendingChanged?.(() => void assets.refresh());
});
onBeforeUnmount(() => unsubscribe?.());
</script>
<template>
  <AppPanel class="asset-panel" :title="assets.current?.title ?? '资产详情'" :subtitle="subtitle" aria-label="资产详情">
    <template #actions>
      <AppTooltip text="查看文档版本" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="查看文档版本"
          :disabled="!editor.activeTab?.document"
          @click="versions.open()"
        >
          <span class="i-mingcute-history-line" />
        </AppButton>
      </AppTooltip>
      <AppTooltip text="刷新资产详情" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="刷新资产详情"
          :disabled="library.loading"
          @click="assets.refresh"
        >
          <span class="i-mingcute-refresh-3-line" />
        </AppButton>
      </AppTooltip>
    </template>

    <AppNotice v-if="assets.error || versions.error" tone="error">{{ assets.error || versions.error }}</AppNotice>
    <template v-if="assets.current">
      <AppPanelSection v-if="isUnclassified(assets.current)" title="未分类" heading>
        <div class="asset-identify">
          <p class="asset-hint">这个文件还没有资产类型。选一个模板识别后，它就会进入资料库并参与双链与结算。</p>
          <AppNotice v-if="assets.current.diagnostic" tone="error">{{ assets.current.diagnostic }}</AppNotice>
          <AppSelect v-model="templateId" aria-label="识别模板">
            <AppSelectItem v-for="item in templates.templates" :key="item.template" :value="item.template">{{
              item.name
            }}</AppSelectItem>
          </AppSelect>
          <AppButton
            size="sm"
            variant="primary"
            :disabled="assets.busy || Boolean(assets.current.diagnostic) || editor.activeTab?.dirty"
            @click="assets.identify(templateId)"
          >
            识别文档
          </AppButton>
        </div>
      </AppPanelSection>

      <AppPanelSection title="待确认事实" :count="pendingCount" heading>
        <p v-if="!pendingCount" class="asset-hint">没有待确认提议</p>
        <AppButton
          v-for="batch in assets.currentBatches"
          :key="batch.id"
          variant="ghost"
          class="asset-link"
          @click="settlement.read(batch.id, assets.current?.sourcePath)"
        >
          <span class="i-mingcute-inbox-2-line size-4 asset-link-icon asset-attention" aria-hidden="true" />
          <span class="asset-link-text">{{ batch.chapterTitle }} · {{ batch.pending }} 项待确认</span>
        </AppButton>
        <AppButton
          v-for="proposal in assets.currentProposals"
          :key="proposal.id"
          variant="ghost"
          class="asset-link"
          @click="assets.inspect(proposal.id)"
        >
          <span class="i-mingcute-document-line size-4 asset-link-icon asset-attention" aria-hidden="true" />
          <span class="asset-link-text">{{ proposal.title }}</span>
        </AppButton>
      </AppPanelSection>

      <AppPanelSection
        v-if="outgoing.length || incoming.length"
        title="人物关系"
        :count="outgoing.length + incoming.length"
        heading
      >
        <div v-for="(relation, index) in outgoing" :key="`out-${index}`" class="asset-relation">
          <AppButton v-if="relation.link?.targetPath" variant="link" @click="assets.open(relation.link.targetPath)">{{
            relation.to
          }}</AppButton>
          <span v-else class="asset-warning">{{ relation.to }}</span>
          <span class="asset-relation-type">{{ relation.type }}</span>
          <p v-if="relation.note" class="asset-relation-note">{{ relation.note }}</p>
        </div>
        <div v-for="(relation, index) in incoming" :key="`in-${index}`" class="asset-relation">
          <AppButton variant="link" @click="assets.open(relation.source.sourcePath)">{{
            relation.source.title
          }}</AppButton>
          <span class="asset-relation-type">将本角色视为{{ relation.type }}</span>
          <p v-if="relation.note" class="asset-relation-note">{{ relation.note }}</p>
        </div>
      </AppPanelSection>

      <AppPanelSection title="双链" :count="assets.current.links.length" heading>
        <p v-if="!assets.current.links.length" class="asset-hint">没有出向引用</p>
        <div v-for="link in assets.current.links" :key="link.link" class="asset-reference">
          <AppButton v-if="link.targetPath" variant="link" class="asset-link" @click="assets.open(link.targetPath)">
            <span class="i-mingcute-link-line size-4 asset-link-icon" aria-hidden="true" />
            <span class="asset-link-text">{{ link.link }}</span>
            <span v-if="link.status === 'moved'" class="i-mingcute-transfer-line size-3.5" aria-label="来源已移动" />
          </AppButton>
          <template v-else>
            <span class="asset-warning asset-broken">
              <span class="i-mingcute-warning-line size-4" aria-hidden="true" /> {{ link.link }} ·
              {{ link.status === 'ambiguous' ? '重名' : '断链' }}
            </span>
            <AppButton
              v-for="candidate in link.candidates"
              :key="candidate"
              variant="link"
              class="asset-link asset-candidate"
              @click="assets.open(candidate)"
            >
              <span class="asset-link-text">{{ candidate }}</span>
            </AppButton>
          </template>
        </div>
      </AppPanelSection>

      <AppPanelSection title="反向引用" :count="backrefs.length" heading>
        <p v-if="!backrefs.length" class="asset-hint">没有反向引用</p>
        <AppButton
          v-for="source in backrefs"
          :key="source.sourcePath"
          variant="link"
          class="asset-link"
          :title="source.sourcePath"
          @click="assets.open(source.sourcePath)"
        >
          <span class="i-mingcute-document-line size-4 asset-link-icon" aria-hidden="true" />
          <span class="asset-link-text">{{ source.title }}</span>
          <span class="asset-kind">{{ assetKindLabel(source.kind) }}</span>
        </AppButton>
      </AppPanelSection>
    </template>
    <AppEmptyState
      v-else
      icon="i-mingcute-box-3-line"
      title="尚未选择已索引文档"
      description="在编辑器里打开一份角色、设定或章节，这里显示它的双链、关系与待确认事实。"
    />
  </AppPanel>
</template>
<style scoped lang="scss">
.asset-identify {
  @apply flex flex-col gap-2 px-5 py-2;
}
.asset-hint {
  @apply m-0 px-5 py-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.asset-identify .asset-hint {
  @apply px-0 py-0;
}
.asset-link {
  @apply h-7 w-full min-w-0 justify-start gap-2 rounded-none px-5 text-left font-normal;
  color: var(--foreground);
}
.asset-link:hover:not(:disabled) {
  background: var(--surface-hover);
  text-decoration: none;
}
.asset-link-icon {
  color: var(--muted-foreground);
}
.asset-attention {
  color: var(--warning);
}
.asset-link-text {
  @apply min-w-0 flex-1 truncate;
}
.asset-candidate {
  @apply pl-10;
}
.asset-relation {
  @apply flex flex-wrap items-center gap-x-2 gap-y-0.5 px-5 py-1;
}
.asset-relation-type {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.asset-relation-note {
  @apply m-0 w-full;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.asset-reference {
  @apply flex flex-col items-stretch;
  overflow-wrap: anywhere;
}
.asset-warning {
  color: var(--warning);
}
.asset-broken {
  @apply flex h-7 items-center gap-1 px-5;
}
.asset-kind {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
</style>
