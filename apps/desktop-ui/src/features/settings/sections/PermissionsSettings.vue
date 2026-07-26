<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { PermissionRuleEntry } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppAlertDialog } from '@/components/AppDialog';
import { useNotificationStore } from '@/features/notifications';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import SettingsSection from '../components/SettingsSection.vue';

const actionMeta = {
  allow: { label: '允许', className: 'is-allow' },
  ask: { label: '每次询问', className: 'is-ask' },
  deny: { label: '拒绝', className: 'is-deny' }
} as const;

const notificationStore = useNotificationStore();
const rules = ref<PermissionRuleEntry[]>([]);
const isLoading = ref(false);
const removingKey = ref('');
const pendingRule = ref<PermissionRuleEntry>();
const isRemoveDialogOpen = ref(false);

const workspaceRules = computed(() => rules.value.filter(rule => rule.scope === 'workspace'));
const globalRules = computed(() => rules.value.filter(rule => rule.scope === 'global'));
const ruleGroups = computed(() => [
  {
    scope: 'workspace' as const,
    title: '本工作区规则',
    description: '仅影响当前打开的工作区，随工作区文件一起保存。',
    emptyText: '暂无工作区规则',
    rules: workspaceRules.value
  },
  {
    scope: 'global' as const,
    title: '全局规则',
    description: '影响所有工作区，请谨慎保留允许类规则。',
    emptyText: '暂无全局规则',
    rules: globalRules.value
  }
]);
const removeDialogTitle = computed(() =>
  pendingRule.value?.scope === 'global' ? '删除这条全局权限规则？' : '删除这条工作区权限规则？'
);
const removeDialogDescription = computed(() => (pendingRule.value ? describeRemoval(pendingRule.value) : ''));
const removeDialogConfirmLabel = computed(() => (pendingRule.value?.scope === 'global' ? '删除全局规则' : '删除规则'));

function ruleKey(rule: PermissionRuleEntry): string {
  return `${rule.scope}\0${rule.action}\0${rule.pattern}`;
}

function describeRemoval(rule: PermissionRuleEntry): string {
  const scopeDescription = rule.scope === 'global' ? '所有工作区' : '本工作区';
  return `删除后，“${rule.pattern}” 将不再从${scopeDescription}的这条规则获得权限。`;
}

function requestRemove(rule: PermissionRuleEntry) {
  pendingRule.value = rule;
  isRemoveDialogOpen.value = true;
}

async function loadRules() {
  isLoading.value = true;

  try {
    rules.value = await getDesktopApi().permissions.listRules();
  } catch (error) {
    notificationStore.error('读取权限规则失败', toErrorMessage(error));
  } finally {
    isLoading.value = false;
  }
}

async function removeRule(rule: PermissionRuleEntry) {
  removingKey.value = ruleKey(rule);

  try {
    rules.value = await getDesktopApi().permissions.removeRule({
      scope: rule.scope,
      pattern: rule.pattern,
      action: rule.action
    });
    notificationStore.success('权限规则已删除', rule.pattern);
  } catch (error) {
    notificationStore.error('删除权限规则失败', toErrorMessage(error));
  } finally {
    removingKey.value = '';
  }
}

function confirmRemove() {
  const rule = pendingRule.value;
  isRemoveDialogOpen.value = false;

  if (rule) {
    void removeRule(rule);
  }
}

onMounted(() => void loadRules());
</script>

<template>
  <SettingsSection
    title="权限"
    title-id="settings-permissions-title"
    description="查看和撤销工具调用的持久规则。临时的单次允许与会话规则不会显示在这里。"
  >
    <template #actions>
      <AppButton type="button" size="xs" :disabled="isLoading || Boolean(removingKey)" @click="loadRules">
        {{ isLoading ? '加载中...' : '刷新' }}
      </AppButton>
    </template>

    <div class="permission-settings-groups">
      <section
        v-for="group in ruleGroups"
        :key="group.scope"
        class="permission-settings-group"
        :class="{ 'is-global': group.scope === 'global' }"
        :aria-labelledby="`${group.scope}-permission-rules-title`"
      >
        <div class="permission-settings-group-heading">
          <div>
            <h4 :id="`${group.scope}-permission-rules-title`" class="permission-settings-group-title">
              {{ group.title }}
            </h4>
            <p class="permission-settings-group-description">{{ group.description }}</p>
          </div>
          <span class="permission-settings-count">{{ group.rules.length }}</span>
        </div>

        <p v-if="!isLoading && group.rules.length === 0" class="permission-settings-empty">{{ group.emptyText }}</p>
        <ul v-else class="permission-settings-list">
          <li v-for="rule in group.rules" :key="ruleKey(rule)" class="permission-settings-item">
            <code class="permission-settings-pattern" :title="rule.pattern">{{ rule.pattern }}</code>
            <span :class="['permission-settings-action', actionMeta[rule.action].className]">
              {{ actionMeta[rule.action].label }}
            </span>
            <AppButton
              icon
              variant="ghost"
              size="xs"
              type="button"
              :disabled="Boolean(removingKey)"
              :aria-label="`删除${group.title} ${rule.pattern}`"
              @click="requestRemove(rule)"
            >
              <span class="i-mingcute-delete-2-line size-4" aria-hidden="true" />
            </AppButton>
          </li>
        </ul>
      </section>
    </div>

    <AppAlertDialog
      v-model:open="isRemoveDialogOpen"
      :title="removeDialogTitle"
      :description="removeDialogDescription"
      :confirm-label="removeDialogConfirmLabel"
      @confirm="confirmRemove"
    />
  </SettingsSection>
</template>

<style scoped lang="scss">
.permission-settings-groups {
  @apply flex flex-col gap-3;
}

.permission-settings-group {
  @apply overflow-hidden border;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  border-radius: var(--radius-control);
}

.permission-settings-group.is-global {
  border-color: var(--warning, #b45309);
}

.permission-settings-group-heading {
  @apply flex items-start justify-between gap-3 border-b px-3 py-2.5;

  border-color: var(--border-subtle);
}

.permission-settings-group-title {
  @apply m-0 text-xs font-semibold;
}

.permission-settings-group-description {
  @apply mt-1 mb-0 text-xs leading-4;

  color: var(--muted-foreground);
}

.permission-settings-count {
  @apply min-w-6 rounded px-1.5 py-0.5 text-center text-xs;

  background: var(--surface-muted);
  color: var(--muted-foreground);
}

.permission-settings-list {
  @apply m-0 list-none p-0;
}

.permission-settings-item {
  @apply flex min-w-0 items-center gap-2 border-b px-3 py-2 last:border-b-0;

  border-color: var(--border-subtle);
}

.permission-settings-pattern {
  @apply min-w-0 flex-1 truncate text-xs;
}

.permission-settings-action {
  @apply shrink-0 rounded px-1.5 py-0.5 text-xs;

  background: var(--surface-muted);
}

.permission-settings-action.is-allow {
  color: var(--primary);
}

.permission-settings-action.is-ask {
  color: var(--warning, #b45309);
}

.permission-settings-action.is-deny {
  color: var(--destructive, #b91c1c);
}

.permission-settings-empty {
  @apply m-0 px-3 py-4 text-center text-xs;

  color: var(--muted-foreground);
}
</style>
