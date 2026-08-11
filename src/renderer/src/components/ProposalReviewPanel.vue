<script setup lang="ts">
import { reactive } from 'vue'
import type { BibleProposal } from '@shared/novel'

defineProps<{ proposals: BibleProposal[]; busy: boolean }>()
const emit = defineEmits<{ decide: [proposalId: string, decision: 'approve' | 'reject', confirmReplacement: boolean] }>()
const replacements = reactive<Record<string, boolean>>({})
const statusLabels: Record<BibleProposal['status'], string> = {
  proposed: '待审核', approved: '已批准', rejected: '已拒绝', superseded: '已被替代'
}
const candidateLines = (proposal: BibleProposal): string[] => {
  const candidate = proposal.candidate
  if ('entry' in candidate) {
    return [
      `资料类型：${candidate.entry.kind}`, `标题：${candidate.entry.title}`,
      `摘要：${candidate.entry.summary || '（空）'}`,
      ...candidate.entry.fields.map((field) => `${field.label}：${field.value}`),
      ...(candidate.entry.relatedEntityIds.length > 0
        ? [`关联对象：${candidate.entry.relatedEntityIds.join('、')}`]
        : [])
    ]
  }
  return [
    `大纲层级：${candidate.outline.kind}`, `标题：${candidate.outline.title}`,
    `摘要：${candidate.outline.summary || '（空）'}`, `目标：${candidate.outline.goal || '（空）'}`,
    `冲突：${candidate.outline.conflict || '（空）'}`, `转折：${candidate.outline.turningPoint || '（空）'}`,
    `钩子：${candidate.outline.hook || '（空）'}`, `目标字数：${candidate.outline.targetWords}`,
    ...(candidate.outline.participantCharacterIds.length > 0
      ? [`参与人物：${candidate.outline.participantCharacterIds.join('、')}`]
      : [])
  ]
}
</script>

<template>
  <section class="proposal-panel" aria-labelledby="proposal-panel-title">
    <header class="bible-section-heading">
      <div><span class="bible-kicker">EDITOR'S PICKS</span><h2 id="proposal-panel-title">主编精选候选</h2></div>
      <span class="bible-count">{{ proposals.length }} 条</span>
    </header>
    <p v-if="proposals.length === 0" class="bible-empty-inline">尚无候选。AI 生成结果会先停在这里等待审核。</p>
    <article v-for="proposal in proposals" :key="proposal.id" class="proposal-card">
      <header>
        <div><span class="bible-status" :data-status="proposal.status">{{ statusLabels[proposal.status] }}</span><h3>{{ proposal.candidate.title }}</h3></div>
        <strong>优先级 {{ proposal.candidate.priority }}</strong>
      </header>
      <p>{{ proposal.candidate.rationale }}</p>
      <section class="proposal-payload" aria-label="候选完整内容">
        <strong>待批准内容</strong>
        <ul><li v-for="line in candidateLines(proposal)" :key="line">{{ line }}</li></ul>
      </section>
      <dl class="proposal-impact">
        <div><dt>影响</dt><dd>{{ proposal.candidate.impact }}</dd></div>
        <div><dt>来源</dt><dd>{{ proposal.sourceVersionIds.join('、') || '当前空白项目' }}</dd></div>
      </dl>
      <section v-if="proposal.candidate.conflicts.length" class="proposal-conflicts" aria-label="冲突证据">
        <strong>需要显式替代的冲突</strong>
        <dl v-for="conflict in proposal.candidate.conflicts" :key="`${proposal.id}-${conflict.field}`">
          <div><dt>字段</dt><dd>{{ conflict.field }}</dd></div>
          <div><dt>旧值</dt><dd>旧值：{{ conflict.oldValue }}</dd></div>
          <div><dt>新值</dt><dd>新值：{{ conflict.newValue }}</dd></div>
          <div><dt>来源版本</dt><dd>来源版本：{{ conflict.sourceVersionId }}</dd></div>
          <div><dt>影响对象</dt><dd>{{ conflict.affectedEntityIds.join('、') || '无' }}</dd></div>
        </dl>
      </section>
      <label v-if="proposal.status === 'proposed' && proposal.candidate.conflicts.length" class="proposal-confirm">
        <input :id="`replace-${proposal.id}`" v-model="replacements[proposal.id]" type="checkbox" :disabled="busy" />
        我已比较旧值、新值与影响对象，确认以候选替代当前权威资料
      </label>
      <div v-if="proposal.status === 'proposed'" class="proposal-card__actions">
        <button class="bible-button bible-button--primary" type="button" :disabled="busy || (proposal.candidate.conflicts.length > 0 && !replacements[proposal.id])" @click="emit('decide', proposal.id, 'approve', Boolean(replacements[proposal.id]))">批准候选</button>
        <button class="bible-button bible-button--danger" type="button" :disabled="busy" @click="emit('decide', proposal.id, 'reject', false)">拒绝</button>
      </div>
    </article>
  </section>
</template>
