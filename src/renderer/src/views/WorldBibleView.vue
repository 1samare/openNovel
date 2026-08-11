<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import type { BibleEntry, BibleEntryKind, BibleSourceVersion, NovelProfileDraft, SaveBibleEntryInput } from '@shared/novel'
import { createNovelBibleController, proposedForDomain } from '@renderer/bible/use-novel-bible'
import BibleEntryEditor from '@renderer/components/BibleEntryEditor.vue'
import ProposalReviewPanel from '@renderer/components/ProposalReviewPanel.vue'

const controller = createNovelBibleController(window.openNovel.novelBible)
const settingKinds: BibleEntryKind[] = ['world-setting', 'location', 'faction', 'item', 'timeline-event', 'foreshadow']
const selected = ref<BibleEntry | null>(null)
const editorRevision = ref(0)
const aiRequest = ref('')
const profileDirty = ref(false)
const profile = reactive<NovelProfileDraft>({
  genre: 'urban-campus', audience: '', theme: '', narrativePov: '', tone: '', styleSample: '', bannedExpressions: []
})
const bannedText = ref('')
let hydratedProjectId: string | null = null
let hydratedProfileVersionId: string | null = null
const entries = computed(() => controller.snapshot.value?.entries.filter((entry) => settingKinds.includes(entry.kind)) ?? [])
const proposals = computed(() => proposedForDomain(controller.snapshot.value, 'setting'))

const hydrateProfile = (snapshot = controller.snapshot.value): void => {
  if (snapshot === null) return
  const saved = snapshot.profile
  const draft: NovelProfileDraft = saved === null
    ? { genre: 'urban-campus', audience: '', theme: '', narrativePov: '', tone: '', styleSample: '', bannedExpressions: [] }
    : {
        genre: saved.genre, audience: saved.audience, theme: saved.theme,
        narrativePov: saved.narrativePov, tone: saved.tone, styleSample: saved.styleSample,
        bannedExpressions: [...saved.bannedExpressions]
      }
  Object.assign(profile, draft)
  bannedText.value = draft.bannedExpressions.join('、')
  hydratedProjectId = snapshot.projectId
  hydratedProfileVersionId = saved?.currentVersionId ?? null
  profileDirty.value = false
}

watch(() => controller.snapshot.value, (snapshot) => {
  if (snapshot !== null && snapshot.projectId !== hydratedProjectId) hydrateProfile(snapshot)
})

const markProfileDirty = (): void => { profileDirty.value = true }

const applyTemplate = (genre: NovelProfileDraft['genre']): void => {
  Object.assign(profile, genre === 'urban-campus' ? {
    genre, audience: '青年读者', theme: '成长、选择与责任', narrativePov: '第三人称限知',
    tone: '克制、温暖并保留悬疑感', styleSample: '', bannedExpressions: ['命运的齿轮']
  } : {
    genre, audience: '青年与成年科幻读者', theme: '技术进步与人的代价', narrativePov: '第三人称限知',
    tone: '冷峻、清晰并保持人性温度', styleSample: '', bannedExpressions: ['万能科技']
  })
  bannedText.value = profile.bannedExpressions.join('、')
  markProfileDirty()
}

const saveProfile = async (): Promise<void> => {
  const saved = await controller.saveProfile({
    expectedVersionId: hydratedProfileVersionId,
    draft: {
      genre: profile.genre,
      audience: profile.audience,
      theme: profile.theme,
      narrativePov: profile.narrativePov,
      tone: profile.tone,
      styleSample: profile.styleSample,
      bannedExpressions: bannedText.value.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean)
    }
  })
  if (saved) hydrateProfile()
}

const saveEntry = async (input: SaveBibleEntryInput): Promise<void> => {
  if (await controller.saveEntry(input)) {
    selected.value = null
    editorRevision.value += 1
  }
}

const versionLines = (version: BibleSourceVersion): string[] => {
  const snapshot = version.snapshot
  if ('genre' in snapshot) {
    return [`题材：${snapshot.genre}`, `目标读者：${snapshot.audience}`, `主题：${snapshot.theme}`, `语气：${snapshot.tone}`]
  }
  if ('fields' in snapshot) {
    return [
      `标题：${snapshot.title}`, `摘要：${snapshot.summary || '（空）'}`,
      ...snapshot.fields.map((field) => `${field.label}：${field.value}`)
    ]
  }
  return [`标题：${snapshot.title}`, `摘要：${snapshot.summary || '（空）'}`]
}

const restoreVersion = async (version: BibleSourceVersion): Promise<void> => {
  const target = controller.versionTarget.value
  if (target === null || !window.confirm(`确认恢复版本 ${version.versionNumber}？当前资料会保留为历史版本。`)) return
  const restored = await controller.restoreVersion({ ...target, versionId: version.id })
  if (restored && target.entityType === 'novel-profile') hydrateProfile()
}

const generate = (): void => {
  if (!aiRequest.value.trim()) return
  void controller.generateProposals({
    domain: 'setting', mode: 'standard', request: aiRequest.value.trim(), targetEntityId: selected.value?.id ?? null
  })
}

onMounted(() => { void controller.load() })
</script>

<template>
  <main class="workspace-page bible-page">
    <header class="bible-hero">
      <div><span class="bible-kicker">NOVEL BIBLE · WORLD</span><h1>世界观圣经</h1><p>把规则、地点、势力、物品、时间线与伏笔沉淀成可追溯的权威资料。</p></div>
      <span class="bible-status" :data-status="controller.status.value">{{ controller.status.value === 'ready' ? '本地已载入' : '正在同步' }}</span>
    </header>

    <section v-if="controller.status.value === 'loading'" class="bible-feedback" role="status">正在读取小说圣经…</section>
    <section v-else-if="controller.status.value === 'error' && !controller.snapshot.value" class="bible-feedback bible-feedback--error" role="alert">
      <div><strong>小说圣经加载失败</strong><p>{{ controller.error.value }}</p></div>
      <button class="bible-button" type="button" @click="controller.load">重试加载</button>
    </section>

    <template v-else-if="controller.snapshot.value">
      <p v-if="controller.error.value" class="bible-feedback bible-feedback--error" role="alert">{{ controller.error.value }}</p>
      <section class="bible-profile-panel" aria-labelledby="novel-profile-heading">
        <header class="bible-section-heading"><div><span class="bible-kicker">FOUNDATION</span><h2 id="novel-profile-heading">{{ controller.snapshot.value.profile ? '作品方向' : '先确定作品方向' }}</h2></div><div><span v-if="controller.snapshot.value.profile" class="bible-lock">主类型已锁定</span><button v-if="controller.snapshot.value.profile" class="bible-button bible-button--quiet" type="button" :disabled="controller.isBusy.value" @click="controller.openVersions({ entityType: 'novel-profile', entityId: controller.snapshot.value.profile.id })">查看档案版本</button></div></header>
        <div class="bible-template-actions">
          <button class="bible-button" type="button" :disabled="controller.isBusy.value || Boolean(controller.snapshot.value.profile)" @click="applyTemplate('urban-campus')">都市校园模板</button>
          <button class="bible-button" type="button" :disabled="controller.isBusy.value || Boolean(controller.snapshot.value.profile)" @click="applyTemplate('sci-fi-future')">科幻未来模板</button>
        </div>
        <form class="bible-form" data-testid="novel-profile-form" @input="markProfileDirty" @submit.prevent="saveProfile">
          <div class="bible-field"><label for="novel-genre">主类型</label><select id="novel-genre" v-model="profile.genre" :disabled="controller.isBusy.value || Boolean(controller.snapshot.value.profile)"><option value="urban-campus">都市校园</option><option value="sci-fi-future">科幻未来</option></select></div>
          <div class="bible-field"><label for="novel-audience">目标读者</label><input id="novel-audience" v-model="profile.audience" required maxlength="200" :disabled="controller.isBusy.value" /></div>
          <div class="bible-field"><label for="novel-theme">核心主题</label><input id="novel-theme" v-model="profile.theme" required maxlength="500" :disabled="controller.isBusy.value" /></div>
          <div class="bible-field"><label for="novel-pov">叙事视角</label><input id="novel-pov" v-model="profile.narrativePov" required maxlength="120" :disabled="controller.isBusy.value" /></div>
          <div class="bible-field"><label for="novel-tone">整体语气</label><input id="novel-tone" v-model="profile.tone" required maxlength="240" :disabled="controller.isBusy.value" /></div>
          <div class="bible-field"><label for="novel-banned">禁用表达</label><input id="novel-banned" v-model="bannedText" maxlength="2000" :disabled="controller.isBusy.value" /></div>
          <div class="bible-field bible-field--wide"><label for="novel-style">风格样例</label><textarea id="novel-style" v-model="profile.styleSample" rows="3" maxlength="10000" :disabled="controller.isBusy.value" /></div>
          <div class="bible-form__actions bible-field--wide"><button class="bible-button bible-button--primary" type="submit" :disabled="controller.isBusy.value">{{ controller.busyAction.value === 'save-profile' ? '正在保存…' : '保存作品方向' }}</button></div>
        </form>
      </section>

      <section class="bible-work-grid">
        <section class="bible-card-panel"><header class="bible-section-heading"><div><span class="bible-kicker">CANON</span><h2>世界资料</h2></div><span class="bible-count">{{ entries.length }} 项</span></header>
          <p v-if="entries.length === 0" class="bible-empty-inline">还没有世界资料。可手工新增，也可先让设定 Agent 给出候选。</p>
          <article v-for="entry in entries" :key="entry.id" class="bible-entry-card"><div><span class="bible-status" :data-status="entry.authorityStatus">{{ entry.authorityStatus === 'approved' ? 'AI 已批准' : '用户确认' }}</span><h3>{{ entry.title }}</h3><p>{{ entry.summary || '尚未填写摘要' }}</p></div><div class="bible-entry-card__actions"><button class="bible-button bible-button--quiet" type="button" :disabled="controller.isBusy.value" @click="selected = entry">编辑</button><button class="bible-button bible-button--quiet" type="button" :disabled="controller.isBusy.value" @click="controller.openVersions({ entityType: entry.kind, entityId: entry.id })">查看版本</button></div></article>
        </section>
        <section class="bible-card-panel"><header class="bible-section-heading"><div><span class="bible-kicker">MANUAL ENTRY</span><h2>{{ selected ? '编辑资料' : '新增资料' }}</h2></div></header><BibleEntryEditor :key="editorRevision" :allowed-kinds="settingKinds" :selected="selected" :busy="controller.isBusy.value" :relation-options="[]" @save="saveEntry" @cancel="selected = null" /></section>
      </section>

      <section class="bible-ai-panel"><div><span class="bible-kicker">SETTING AGENT</span><h2>AI 完善世界观</h2><p>结果只会进入候选区，批准前不会替换任何权威资料。</p></div><div class="bible-ai-panel__composer"><label for="world-ai-request">希望 Agent 处理什么</label><textarea id="world-ai-request" v-model="aiRequest" rows="3" placeholder="例如：补全钟楼规则，并标注会影响的前三章线索" :disabled="controller.isBusy.value" /><div><button class="bible-button bible-button--primary" type="button" :disabled="controller.isBusy.value || !aiRequest.trim()" @click="generate">{{ controller.busyAction.value === 'generate-proposals' ? '正在生成…' : '生成设定候选' }}</button><button v-if="controller.busyAction.value === 'generate-proposals'" class="bible-button" type="button" @click="controller.cancelGeneration">取消生成</button></div></div></section>

      <ProposalReviewPanel :proposals="proposals" :busy="controller.isBusy.value" @decide="(proposalId, decision, confirmReplacement) => controller.decideProposal({ proposalId, decision, confirmReplacement })" />

      <section v-if="controller.versionTarget.value" class="bible-version-panel" aria-labelledby="world-version-heading"><header class="bible-section-heading"><h2 id="world-version-heading">来源版本</h2><button class="bible-button bible-button--quiet" type="button" @click="controller.versionTarget.value = null; controller.versions.value = []">关闭</button></header><p v-if="controller.versions.value.length === 0" class="bible-empty-inline">没有可恢复的历史版本。</p><article v-for="version in controller.versions.value" :key="version.id"><div><strong>版本 {{ version.versionNumber }}</strong><span>{{ version.sourceKind === 'agent' ? 'Agent 批准' : version.sourceKind === 'restore' ? `历史恢复（来自版本 ${version.restoredFromVersionId ?? '未知'}）` : '用户保存' }}</span></div><ul><li v-for="line in versionLines(version)" :key="line">{{ line }}</li></ul><button class="bible-button" type="button" :disabled="controller.isBusy.value" @click="restoreVersion(version)">恢复此版本</button></article></section>
    </template>
  </main>
</template>
