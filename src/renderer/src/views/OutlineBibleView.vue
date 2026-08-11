<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { BibleSourceVersion, OutlineNode, OutlineNodeDraft, OutlineNodeKind } from '@shared/novel'
import { createNovelBibleController, proposedForDomain } from '@renderer/bible/use-novel-bible'
import OutlineTree from '@renderer/components/OutlineTree.vue'
import ProposalReviewPanel from '@renderer/components/ProposalReviewPanel.vue'

const controller = createNovelBibleController(window.openNovel.novelBible)
const selected = ref<OutlineNode | null>(null)
const aiRequest = ref('')
const form = reactive<OutlineNodeDraft>({ kind: 'story', parentId: null, title: '', summary: '', goal: '', conflict: '', turningPoint: '', hook: '', targetWords: 0, participantCharacterIds: [], position: 0 })
const proposals = computed(() => proposedForDomain(controller.snapshot.value, 'plot'))
const characters = computed(() => controller.snapshot.value?.entries.filter((entry) => entry.kind === 'character') ?? [])
const parentKind: Record<OutlineNodeKind, OutlineNodeKind | null> = { story: null, volume: 'story', stage: 'volume', 'chapter-plan': 'stage' }
const parentOptions = computed(() => controller.snapshot.value?.outline.filter((node) => node.kind === parentKind[form.kind]) ?? [])
watch(() => form.kind, () => {
  if (selected.value) return
  form.parentId = parentKind[form.kind] === null ? null : parentOptions.value[0]?.id ?? null
})
const reset = (): void => { selected.value = null; Object.assign(form, { kind: 'story', parentId: null, title: '', summary: '', goal: '', conflict: '', turningPoint: '', hook: '', targetWords: 0, participantCharacterIds: [], position: 0 }) }
const selectNode = (node: OutlineNode): void => {
  selected.value = node
  Object.assign(form, {
    kind: node.kind, parentId: node.parentId, title: node.title, summary: node.summary,
    goal: node.goal, conflict: node.conflict, turningPoint: node.turningPoint, hook: node.hook,
    targetWords: node.targetWords, participantCharacterIds: [...node.participantCharacterIds],
    position: node.position
  })
}
const save = async (): Promise<void> => {
  const siblings = controller.snapshot.value?.outline.filter((node) => node.kind === form.kind && node.parentId === form.parentId) ?? []
  const saved = await controller.saveOutlineNode({
    nodeId: selected.value?.id ?? null,
    expectedVersionId: selected.value?.currentVersionId ?? null,
    draft: { ...form, position: selected.value?.position ?? siblings.length }
  })
  if (saved) reset()
}
const versionLines = (version: BibleSourceVersion): string[] => {
  const snapshot = version.snapshot
  if (!('goal' in snapshot)) return []
  return [
    `标题：${snapshot.title}`, `摘要：${snapshot.summary || '（空）'}`, `目标：${snapshot.goal || '（空）'}`,
    `冲突：${snapshot.conflict || '（空）'}`, `转折：${snapshot.turningPoint || '（空）'}`,
    `钩子：${snapshot.hook || '（空）'}`, `位置：${snapshot.position}`,
    ...(snapshot.participantCharacterIds.length > 0 ? [`参与人物：${snapshot.participantCharacterIds.join('、')}`] : [])
  ]
}
const restoreVersion = async (version: BibleSourceVersion): Promise<void> => {
  const target = controller.versionTarget.value
  if (target === null || !window.confirm(`确认恢复版本 ${version.versionNumber}？当前节点会保留为历史版本。`)) return
  await controller.restoreVersion({ ...target, versionId: version.id })
}
const generate = (): void => {
  if (!aiRequest.value.trim()) return
  void controller.generateProposals({ domain: 'plot', mode: 'standard', request: aiRequest.value.trim(), targetEntityId: selected.value?.id ?? null })
}
onMounted(() => { void controller.load() })
</script>

<template>
  <main class="workspace-page bible-page">
    <header class="bible-hero"><div><span class="bible-kicker">NOVEL BIBLE · OUTLINE</span><h1>结构化大纲</h1><p>按总纲、分卷、故事阶段和章节规划组织因果链，局部重生成先进入候选。</p></div><span class="bible-status" :data-status="controller.status.value">{{ controller.status.value === 'ready' ? '层级已校验' : '正在同步' }}</span></header>
    <section v-if="controller.status.value === 'loading'" class="bible-feedback" role="status">正在读取分层大纲…</section>
    <section v-else-if="controller.status.value === 'error' && !controller.snapshot.value" class="bible-feedback bible-feedback--error" role="alert"><div><strong>小说圣经加载失败</strong><p>{{ controller.error.value }}</p></div><button class="bible-button" type="button" @click="controller.load">重试加载</button></section>
    <template v-else-if="controller.snapshot.value">
      <p v-if="controller.error.value" class="bible-feedback bible-feedback--error" role="alert">{{ controller.error.value }}</p>
      <section class="outline-workspace"><section class="bible-card-panel"><header class="bible-section-heading"><div><span class="bible-kicker">STORY MAP</span><h2>总纲 → 分卷 → 阶段 → 章节</h2></div><span class="bible-count">{{ controller.snapshot.value.outline.length }} 节点</span></header><OutlineTree :nodes="controller.snapshot.value.outline" :selected-id="selected?.id ?? null" :busy="controller.isBusy.value" @select="selectNode" @move="(nodeId, direction) => controller.moveOutlineNode({ nodeId, direction })" @versions="(node) => controller.openVersions({ entityType: node.kind, entityId: node.id })" /></section>
        <section class="bible-card-panel">
          <header class="bible-section-heading"><div><span class="bible-kicker">OUTLINE ENTRY</span><h2>{{ selected ? '编辑大纲节点' : '新增大纲节点' }}</h2></div></header>
          <form class="bible-form" data-testid="outline-form" @submit.prevent="save">
            <div class="bible-field"><label for="outline-kind">层级</label><select id="outline-kind" v-model="form.kind" :disabled="controller.isBusy.value || Boolean(selected)"><option value="story">故事总纲</option><option value="volume">分卷</option><option value="stage">故事阶段</option><option value="chapter-plan">章节规划</option></select></div>
            <div v-if="parentKind[form.kind]" class="bible-field"><label for="outline-parent">父级</label><select id="outline-parent" v-model="form.parentId" required :disabled="controller.isBusy.value || Boolean(selected)"><option :value="null" disabled>请选择父级</option><option v-for="parent in parentOptions" :key="parent.id" :value="parent.id">{{ parent.title }}</option></select></div>
            <div class="bible-field"><label for="outline-title">标题</label><input id="outline-title" v-model="form.title" required maxlength="160" :disabled="controller.isBusy.value" /></div>
            <div class="bible-field"><label for="outline-target-words">目标字数</label><input id="outline-target-words" v-model.number="form.targetWords" type="number" min="0" max="20000" required :disabled="controller.isBusy.value" /></div>
            <div class="bible-field bible-field--wide"><label for="outline-summary">摘要</label><textarea id="outline-summary" v-model="form.summary" rows="3" maxlength="20000" :disabled="controller.isBusy.value" /></div>
            <div class="bible-field"><label for="outline-goal">目标</label><textarea id="outline-goal" v-model="form.goal" rows="3" maxlength="20000" :disabled="controller.isBusy.value" /></div>
            <div class="bible-field"><label for="outline-conflict">冲突</label><textarea id="outline-conflict" v-model="form.conflict" rows="3" maxlength="20000" :disabled="controller.isBusy.value" /></div>
            <div class="bible-field"><label for="outline-turning">转折</label><textarea id="outline-turning" v-model="form.turningPoint" rows="3" maxlength="20000" :disabled="controller.isBusy.value" /></div>
            <div class="bible-field"><label for="outline-hook">章尾钩子</label><textarea id="outline-hook" v-model="form.hook" rows="3" maxlength="20000" :disabled="controller.isBusy.value" /></div>
            <fieldset class="bible-field bible-field--wide bible-relation-options"><legend>参与人物</legend><label v-for="character in characters" :key="character.id"><input v-model="form.participantCharacterIds" name="outline-participant" type="checkbox" :value="character.id" :disabled="controller.isBusy.value" />{{ character.title }}</label><p v-if="characters.length === 0" class="bible-empty-inline">尚无人物档案，可稍后补充。</p></fieldset>
            <div class="bible-form__actions bible-field--wide"><button class="bible-button bible-button--primary" type="submit" :disabled="controller.isBusy.value || !form.title.trim()">{{ selected ? '保存节点' : '新增节点' }}</button><button v-if="selected" class="bible-button bible-button--quiet" type="button" @click="reset">取消编辑</button></div>
          </form>
        </section></section>
      <section class="bible-ai-panel"><div><span class="bible-kicker">PLOT AGENT</span><h2>局部重生成候选</h2><p>可针对选中节点重新规划；批准前不会覆盖当前树。</p></div><div class="bible-ai-panel__composer"><label for="outline-ai-request">剧情规划要求</label><textarea id="outline-ai-request" v-model="aiRequest" rows="3" placeholder="例如：重新规划前三章，每章明确目标、冲突、转折和钩子" :disabled="controller.isBusy.value" /><div><button class="bible-button bible-button--primary" type="button" :disabled="controller.isBusy.value || !aiRequest.trim()" @click="generate">{{ controller.busyAction.value === 'generate-proposals' ? '正在生成…' : '生成局部候选' }}</button><button v-if="controller.busyAction.value === 'generate-proposals'" class="bible-button" type="button" @click="controller.cancelGeneration">取消生成</button></div></div></section>
      <ProposalReviewPanel :proposals="proposals" :busy="controller.isBusy.value" @decide="(proposalId, decision, confirmReplacement) => controller.decideProposal({ proposalId, decision, confirmReplacement })" />
      <section v-if="controller.versionTarget.value" class="bible-version-panel"><header class="bible-section-heading"><h2>大纲版本</h2><button class="bible-button bible-button--quiet" type="button" @click="controller.versionTarget.value = null; controller.versions.value = []">关闭</button></header><p v-if="controller.versions.value.length === 0" class="bible-empty-inline">没有可恢复的历史版本。</p><article v-for="version in controller.versions.value" :key="version.id"><div><strong>版本 {{ version.versionNumber }}</strong><span>{{ version.sourceKind === 'restore' ? `restore · 来自 ${version.restoredFromVersionId ?? '未知'}` : version.sourceKind }}</span></div><ul><li v-for="line in versionLines(version)" :key="line">{{ line }}</li></ul><button class="bible-button" type="button" :disabled="controller.isBusy.value" @click="restoreVersion(version)">恢复此版本</button></article></section>
    </template>
  </main>
</template>
