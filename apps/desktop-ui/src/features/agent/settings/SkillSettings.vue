<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import type { ManagedSkillsSnapshot, ManagedSkillView, SkillScope } from '@chaptale/agent-host/protocol';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { AppNotice } from '@/components/AppNotice';
import { useCreationStore } from '@/features/creation';
import { SettingsSectionView as SettingsSection } from '@/features/settings';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import SkillGroupSection from './SkillGroupSection.vue';

const creation = useCreationStore();
const snapshot = ref<ManagedSkillsSnapshot | null>(null);
const busy = ref(false);
const error = ref('');
const pendingRemove = ref<ManagedSkillView | null>(null);
const removeDialogOpen = ref(false);

const activeWork = computed(() =>
  creation.workId ? creation.works.find(item => item.id === creation.workId) : undefined
);
const workSkills = computed(() => snapshot.value?.skills.filter(item => item.scope === 'work') ?? []);
const globalSkills = computed(() => snapshot.value?.skills.filter(item => item.scope === 'global') ?? []);
const canSelectSource = computed(() => typeof getDesktopApi().agentHost.selectSkillSource === 'function');
const canRevealPath = computed(() => typeof getDesktopApi().agentHost.revealSkillPath === 'function');

async function runSkillAction(action: () => Promise<void>) {
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

async function refresh() {
  await runSkillAction(async () => {
    snapshot.value = await getDesktopApi().agentHost.request('listSkills', {
      workId: creation.workId
    });
  });
}

onMounted(() => {
  void refresh();
});

watch(
  () => creation.workId,
  () => {
    void refresh();
  }
);

function handleToggle(skill: ManagedSkillView, enabled: boolean) {
  void runSkillAction(async () => {
    snapshot.value = await getDesktopApi().agentHost.request('setSkillEnabled', {
      scope: skill.scope,
      workId: creation.workId,
      name: skill.name,
      enabled
    });
  });
}

function handleCreate(payload: {
  scope: SkillScope;
  name: string;
  description: string;
  disableModelInvocation: boolean;
}) {
  void runSkillAction(async () => {
    const result = await getDesktopApi().agentHost.request('createSkill', {
      scope: payload.scope,
      workId: creation.workId,
      name: payload.name,
      description: payload.description,
      disableModelInvocation: payload.disableModelInvocation
    });
    snapshot.value = result.snapshot;
  });
}

function handleImport(scope: SkillScope, kind: 'directory' | 'file') {
  void runSkillAction(async () => {
    const select = getDesktopApi().agentHost.selectSkillSource;
    if (!select) return;
    const sourcePath = await select(kind);
    if (!sourcePath) return;
    const result = await getDesktopApi().agentHost.request('importSkill', {
      scope,
      workId: creation.workId,
      sourcePath
    });
    snapshot.value = result.snapshot;
  });
}

function handleReveal(filePath: string) {
  void runSkillAction(async () => {
    await getDesktopApi().agentHost.revealSkillPath?.({
      workId: creation.workId,
      filePath
    });
  });
}

function requestRemove(skill: ManagedSkillView) {
  pendingRemove.value = skill;
  removeDialogOpen.value = true;
}

function confirmRemove() {
  const target = pendingRemove.value;
  if (!target) return;
  void runSkillAction(async () => {
    const result = await getDesktopApi().agentHost.request('removeSkill', {
      scope: target.scope,
      workId: creation.workId,
      filePath: target.filePath
    });
    snapshot.value = result.snapshot;
    pendingRemove.value = null;
  });
}
</script>

<template>
  <SettingsSection
    title="技能"
    title-id="settings-skills-title"
    description="管理可按需加载的创作规范与辅助流程（SKILL.md）。助手按技能说明自动读取，你也可以在输入框输入 / 点名调用。"
  >
    <template #actions>
      <AppButton type="button" size="sm" variant="ghost" :disabled="busy" @click="refresh">
        <span class="i-mingcute-refresh-2-line size-4" aria-hidden="true" />
        <span>刷新</span>
      </AppButton>
    </template>

    <div class="skill-settings">
      <AppNotice v-if="error" tone="error">{{ error }}</AppNotice>

      <section v-if="snapshot?.diagnostics.length" class="skill-diagnostics" aria-label="技能格式告警">
        <header class="skill-diagnostics-title">
          <span class="i-mingcute-warning-line size-4 shrink-0" aria-hidden="true" />
          <span>有 {{ snapshot.diagnostics.length }} 个技能文件存在格式问题，请修正后点击刷新：</span>
        </header>
        <ul class="skill-diagnostics-list">
          <li
            v-for="(diag, index) in snapshot.diagnostics"
            :key="`${diag.path}:${index}`"
            class="skill-diagnostics-row"
          >
            <div class="settings-model-copy">
              <span>{{ diag.message }}</span>
              <code v-if="diag.path">{{ diag.path }}</code>
            </div>
            <AppButton
              v-if="canRevealPath && diag.path"
              type="button"
              size="sm"
              variant="ghost"
              :disabled="busy"
              @click="handleReveal(diag.path)"
            >
              定位文件
            </AppButton>
          </li>
        </ul>
      </section>

      <SkillGroupSection
        v-if="creation.workId"
        scope="work"
        :title="activeWork ? `当前作品《${activeWork.title}》` : '当前作品'"
        :aria-label="activeWork ? `当前作品《${activeWork.title}》技能` : '当前作品技能'"
        hint="仅在当前作品中生效；与全局技能同名时接管全局项，随作品保留。"
        :dir-path="snapshot?.workDir ?? null"
        :skills="workSkills"
        :busy="busy"
        :can-select-source="canSelectSource"
        :can-reveal-path="canRevealPath"
        @toggle-enabled="handleToggle"
        @create="handleCreate"
        @import-source="handleImport"
        @reveal-path="handleReveal"
        @request-remove="requestRemove"
      />
      <div v-else class="settings-empty-card">打开具体作品后，可在此管理该作品专属的技能。</div>

      <SkillGroupSection
        scope="global"
        title="全局技能"
        aria-label="全局技能"
        hint="对所有作品与独立对话生效。"
        :dir-path="snapshot?.globalDir ?? null"
        :skills="globalSkills"
        :busy="busy"
        :can-select-source="canSelectSource"
        :can-reveal-path="canRevealPath"
        @toggle-enabled="handleToggle"
        @create="handleCreate"
        @import-source="handleImport"
        @reveal-path="handleReveal"
        @request-remove="requestRemove"
      />

      <AppAlertDialog
        :open="removeDialogOpen"
        :title="pendingRemove ? `移除技能“${pendingRemove.name}”？` : '移除技能？'"
        description="技能文件将移入系统回收站，需要时可从回收站还原。"
        confirm-label="移入回收站"
        @update:open="removeDialogOpen = $event"
        @confirm="confirmRemove"
      />
    </div>
  </SettingsSection>
</template>

<style scoped lang="scss">
.skill-settings {
  @apply flex flex-col gap-6;
}

.skill-diagnostics {
  @apply flex flex-col gap-2 border p-3;
  background: var(--surface);
  border-color: var(--border);
  border-radius: var(--radius-control);
}

.skill-diagnostics-title {
  @apply flex items-center gap-1.5 text-xs font-medium;
  color: var(--warning);
}

.skill-diagnostics-list {
  @apply m-0 flex list-none flex-col divide-y p-0;
}

.skill-diagnostics-row {
  @apply flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0;
  border-color: var(--border-subtle);
}
</style>
