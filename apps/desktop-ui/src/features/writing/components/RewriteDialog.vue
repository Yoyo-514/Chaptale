<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { useWritingStore } from '../store';
const writing = useWritingStore();
</script>
<template>
  <AppDialog
    :open="Boolean(writing.rewrite)"
    title="提出候选修订"
    content-size="lg"
    @update:open="open => !open && (writing.rewrite = null)"
  >
    <div v-if="writing.rewrite" class="rewrite-confirm">
      <dl>
        <dt>目标文件</dt>
        <dd>{{ writing.rewrite.plan.targetPath }}</dd>
        <dt>输入对象</dt>
        <dd>
          {{ writing.rewrite.plan.parentId ? '候选稿' : '已保存正文' }} · 全文
          {{ writing.rewrite.plan.sourceText.length }} 字符
        </dd>
        <dt>本次写作参考</dt>
        <dd>{{ writing.rewrite.packId.slice(0, 8) }}</dd>
        <dt>Persona</dt>
        <dd>rewriter · rewrite-minimal-diff</dd>
      </dl>
      <section aria-label="选中的问题">
        <h3>选中问题 · {{ writing.rewrite.plan.issues.length }}</h3>
        <article v-for="(issue, index) in writing.rewrite.plan.issues" :key="index">
          <blockquote>{{ issue.quote }}</blockquote>
          <p>{{ issue.reason }}</p>
          <p>{{ issue.suggestion }}</p>
        </article>
      </section>
      <section aria-label="允许修改的原文">
        <h3>允许修改的原文</h3>
        <pre v-for="span in writing.rewrite.plan.spans" :key="span.from">{{ span.text }}</pre>
      </section>
      <label
        >模型<AppSelect
          aria-label="修订模型"
          :model-value="
            String(
              writing.models.findIndex(
                model =>
                  model.provider === writing.rewrite?.model?.provider && model.id === writing.rewrite.model.modelId
              )
            )
          "
          @update:model-value="
            value => {
              const model = writing.models[Number(value)];
              if (model && writing.rewrite) writing.rewrite.model = { provider: model.provider, modelId: model.id };
            }
          "
        >
          <AppSelectItem v-if="!writing.models.length" value="-1">未配置可用模型</AppSelectItem>
          <AppSelectItem v-for="(model, index) in writing.models" :key="index" :value="String(index)">
            {{ model.providerName }} / {{ model.name }}
          </AppSelectItem>
        </AppSelect></label
      >
      <label
        ><AppCheckbox
          :model-value="writing.rewrite.allowStalePack"
          @update:model-value="writing.rewrite.allowStalePack = $event === true"
        />允许使用来源已更新的旧参考快照</label
      >
      <footer>
        <AppButton size="sm" @click="writing.rewrite = null">取消</AppButton>
        <AppButton size="sm" :disabled="!writing.rewrite.model" @click="writing.generateRewrite"
          >创建修订候选</AppButton
        >
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.rewrite-confirm {
  @apply flex min-h-0 flex-col gap-4 overflow-auto pt-3;
  font-size: var(--ui-font-size);
  max-height: 75vh;
}
dl {
  @apply grid grid-cols-[7rem_minmax(0,1fr)] gap-2;
}
dd {
  @apply m-0;
  overflow-wrap: anywhere;
}
dt {
  color: var(--muted-foreground);
}
h3 {
  @apply mb-2 text-xs font-medium;
}
article {
  @apply border-b py-2;
  border-color: var(--border-subtle);
}
blockquote {
  @apply mx-0 my-1 border-l-2 pl-2;
  border-color: var(--primary-solid);
}
p {
  @apply my-1;
  overflow-wrap: anywhere;
}
pre {
  @apply m-0 mb-2 whitespace-pre-wrap border-l-2 pl-2 font-mono text-xs;
  border-color: var(--border-subtle);
  overflow-wrap: anywhere;
}
label {
  @apply flex flex-wrap items-center gap-2;
}
footer {
  @apply flex shrink-0 justify-end gap-2;
}
</style>
