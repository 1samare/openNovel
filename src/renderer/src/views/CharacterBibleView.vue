<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { BibleEntry, BibleEntryKind, BibleSourceVersion, SaveBibleEntryInput } from '@shared/novel'
import { createNovelBibleController, proposedForDomain } from '@renderer/bible/use-novel-bible'
import BibleEntryEditor from '@renderer/components/BibleEntryEditor.vue'
import ProposalReviewPanel from '@renderer/components/ProposalReviewPanel.vue'

const controller = createNovelBibleController(window.openNovel.novelBible)
const characterKinds: BibleEntryKind[] = ['character', 'relationship', 'character-state']
const selected = ref<BibleEntry | null>(null)
const editorRevision = ref(0)
const aiRequest = ref('')
const entries = computed(() => controller.snapshot.value?.entries.filter((entry) => characterKinds.includes(entry.kind)) ?? [])
const characters = computed(() => entries.value.filter((entry) => entry.kind === 'character'))
const proposals = computed(() => proposedForDomain(controller.snapshot.value, 'character'))
const labelFor = (kind: BibleEntryKind): string => kind === 'relationship' ? '人物关系' : kind === 'character-state' ? '阶段状态' : '人物档案'
const saveEntry = async (input: SaveBibleEntryInput): Promise<void> => {
  if (await controller.saveEntry(input)) {
    selected.value = null
    editorRevision.value += 1
  }
}
const versionLines = (version: BibleSourceVersion): string[] => {
  const snapshot = version.snapshot
  if (!('fields' in snapshot)) return []
  return [
    `标题：${snapshot.title}`, `摘要：${snapshot.summary || '（空）'}`,
    ...snapshot.fields.map((field) => `${field.label}：${field.value}`),
    ...(snapshot.relatedEntityIds.length > 0 ? [`关联人物：${snapshot.relatedEntityIds.join('、')}`] : [])
  ]
}
const restoreVersion = async (version: BibleSourceVersion): Promise<void> => {
  const target = controller.versionTarget.value
  if (target === null || !window.confirm(`确认恢复版本 ${version.versionNumber}？当前资料会保留为历史版本。`)) return
  await controller.restoreVersion({ ...target, versionId: version.id })
}
const generate = (): void => {
  if (!aiRequest.value.trim()) return
  void controller.generateProposals({ domain: 'character', mode: 'standard', request: aiRequest.value.trim(), targetEntityId: selected.value?.id ?? null })
}
onMounted(() => { void controller.load() })
</script>

<template>
  <main class="workspace-page bible-page">
    <header class="bible-hero"><div><span class="bible-kicker">NOVEL BIBLE · CHARACTER</span><h1>人物圣经</h1><p>维护人物动机、关系和阶段状态，让每次选择都有来源可查。</p></div><span class="bible-status" :data-status="controller.status.value">{{ controller.status.value === 'ready' ? '本地已载入' : '正在同步' }}</span></header>
    <section v-if="controller.status.value === 'loading'" class="bible-feedback" role="status">正在读取人物资料…</section>
    <section v-else-if="controller.status.value === 'error' && !controller.snapshot.value" class="bible-feedback bible-feedback--error" role="alert"><div><strong>小说圣经加载失败</strong><p>{{ controller.error.value }}</p></div><button class="bible-button" type="button" @click="controller.load">重试加载</button></section>
    <template v-else-if="controller.snapshot.value">
      <p v-if="controller.error.value" class="bible-feedback bible-feedback--error" role="alert">{{ controller.error.value }}</p>
      <p v-if="!controller.snapshot.value.profile" class="bible-feedback">建议先在世界观页保存作品方向；手工人物资料仍可继续维护。</p>
      <section class="bible-work-grid"><section class="bible-card-panel"><header class="bible-section-heading"><div><span class="bible-kicker">CAST</span><h2>人物、关系与状态</h2></div><span class="bible-count">{{ entries.length }} 项</span></header><p v-if="entries.length === 0" class="bible-empty-inline">还没有人物资料。先创建主要人物，再补充关系和阶段状态。</p><article v-for="entry in entries" :key="entry.id" class="bible-entry-card"><div><span class="bible-status" :data-status="entry.authorityStatus">{{ labelFor(entry.kind) }} · {{ entry.authorityStatus === 'approved' ? 'AI 已批准' : '用户确认' }}</span><h3>{{ entry.title }}</h3><p>{{ entry.summary || '尚未填写摘要' }}</p><small v-if="entry.relatedEntityIds.length">关联人物：{{ entry.relatedEntityIds.map((id) => characters.find((character) => character.id === id)?.title ?? id).join('、') }}</small></div><div class="bible-entry-card__actions"><button class="bible-button bible-button--quiet" type="button" :disabled="controller.isBusy.value" @click="selected = entry">编辑</button><button class="bible-button bible-button--quiet" type="button" :disabled="controller.isBusy.value" @click="controller.openVersions({ entityType: entry.kind, entityId: entry.id })">查看版本</button></div></article></section><section class="bible-card-panel"><header class="bible-section-heading"><div><span class="bible-kicker">CHARACTER ENTRY</span><h2>{{ selected ? '编辑人物资料' : '新增人物资料' }}</h2></div></header><BibleEntryEditor :key="editorRevision" :allowed-kinds="characterKinds" :selected="selected" :busy="controller.isBusy.value" :relation-options="characters" @save="saveEntry" @cancel="selected = null" /></section></section>
      <section class="bible-ai-panel"><div><span class="bible-kicker">CHARACTER AGENT</span><h2>AI 完善人物</h2><p>可针对当前选中人物，也可提出新的主要人物候选。</p></div><div class="bible-ai-panel__composer"><label for="character-ai-request">人物完善要求</label><textarea id="character-ai-request" v-model="aiRequest" rows="3" placeholder="例如：补全林澈的核心欲望、恐惧和第三章前状态" :disabled="controller.isBusy.value" /><div><button class="bible-button bible-button--primary" type="button" :disabled="controller.isBusy.value || !aiRequest.trim()" @click="generate">{{ controller.busyAction.value === 'generate-proposals' ? '正在生成…' : '生成人物候选' }}</button><button v-if="controller.busyAction.value === 'generate-proposals'" class="bible-button" type="button" @click="controller.cancelGeneration">取消生成</button></div></div></section>
      <ProposalReviewPanel :proposals="proposals" :busy="controller.isBusy.value" @decide="(proposalId, decision, confirmReplacement) => controller.decideProposal({ proposalId, decision, confirmReplacement })" />
      <section v-if="controller.versionTarget.value" class="bible-version-panel"><header class="bible-section-heading"><h2>人物资料版本</h2><button class="bible-button bible-button--quiet" type="button" @click="controller.versionTarget.value = null; controller.versions.value = []">关闭</button></header><p v-if="controller.versions.value.length === 0" class="bible-empty-inline">没有可恢复的历史版本。</p><article v-for="version in controller.versions.value" :key="version.id"><div><strong>版本 {{ version.versionNumber }}</strong><span>{{ version.sourceKind === 'restore' ? `restore · 来自 ${version.restoredFromVersionId ?? '未知'}` : version.sourceKind }}</span></div><ul><li v-for="line in versionLines(version)" :key="line">{{ line }}</li></ul><button class="bible-button" type="button" :disabled="controller.isBusy.value" @click="restoreVersion(version)">恢复此版本</button></article></section>
    </template>
  </main>
</template>
