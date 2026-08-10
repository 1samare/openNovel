<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

import ChapterTextEditor from '@renderer/components/ChapterTextEditor.vue'
import { installBeforeUnloadFlush, registerWorkspaceFlush } from '@renderer/editor/workspace-flush'
import { useChapterEditor } from '@renderer/editor/use-chapter-editor'
import { countChineseProseCharacters } from '@shared/chapter'
import type {
  ChapterKind,
  ChapterVersionSummary,
  ExportFormat,
  ImportMode,
  ImportPreview
} from '@shared/chapter'

const props = withDefaults(defineProps<{
  initialPanel?: 'versions' | 'transfer' | null
}>(), { initialPanel: null })

const session = useChapterEditor(window.openNovel.chapters)
const panel = ref<'versions' | 'transfer' | null>(props.initialPanel)
const newKind = ref<ChapterKind>('chapter')
const newParentId = ref('')
const newTitle = ref('')
const activeTitle = ref('')
const deleteArmed = ref(false)
const selectedNodeId = ref('')
const selectedNodeTitle = ref('')
const selectedParentId = ref('')
const treeDeleteArmed = ref(false)
const versions = ref<ChapterVersionSummary[]>([])
const previewVersion = ref<ChapterVersionSummary | null>(null)
const restoreArmedId = ref<string | null>(null)
const importMode = ref<ImportMode>('split-chapters')
const importText = ref('')
const importPreview = ref<ImportPreview | null>(null)
const actionStatus = ref('')
const actionError = ref('')
const busy = ref(false)
let unregisterFlush: (() => void) | undefined
let removeBeforeUnload: (() => void) | undefined

if (getCurrentInstance()?.appContext.config.globalProperties.$router !== undefined) {
  onBeforeRouteLeave(async () => {
    const saved = await session.flush()
    if (saved) return true
    actionError.value = session.error.value || '正文尚未保存，请处理保存错误后再离开。'
    return false
  })
}

const rootItems = computed(() => session.chapters.value
  .filter((chapter) => chapter.parentId === null)
  .sort((left, right) => left.position - right.position))
const childrenOf = (parentId: string) => session.chapters.value
  .filter((chapter) => chapter.parentId === parentId)
  .sort((left, right) => left.position - right.position)
const volumes = computed(() => rootItems.value.filter((item) => item.kind === 'volume'))
const selectedNode = computed(() => session.chapters.value.find(
  (chapter) => chapter.id === selectedNodeId.value
) ?? null)
const selectedSiblings = computed(() => selectedNode.value === null
  ? []
  : session.chapters.value
    .filter((chapter) => chapter.parentId === selectedNode.value?.parentId)
    .sort((left, right) => left.position - right.position))
const selectedIndex = computed(() => selectedSiblings.value.findIndex(
  (chapter) => chapter.id === selectedNodeId.value
))
const canMoveSelectedUp = computed(() => selectedIndex.value > 0)
const canMoveSelectedDown = computed(() =>
  selectedIndex.value >= 0 && selectedIndex.value < selectedSiblings.value.length - 1
)

const saveLabel = computed(() => ({
  idle: '尚无改动', dirty: '等待自动保存', saving: '正在保存…', saved: '已保存',
  conflict: '保存冲突', error: '保存失败'
})[session.saveState.value])
const characterCount = computed(() => countChineseProseCharacters(session.content.value))
const versionStatusLabel = (status: ChapterVersionSummary['status']) => ({
  draft: '草稿快照',
  confirmed: '已确认',
  superseded: '已取代'
})[status]

watch(session.activeChapter, (chapter) => {
  activeTitle.value = chapter?.title ?? ''
  deleteArmed.value = false
  versions.value = []
  previewVersion.value = null
  restoreArmedId.value = null
  if (panel.value === 'versions' && chapter !== null) void loadVersions()
})
watch(() => session.activeChapter.value?.id, (chapterId) => {
  if (chapterId !== undefined) selectedNodeId.value = chapterId
})
watch(selectedNode, (node) => {
  selectedNodeTitle.value = node?.title ?? ''
  selectedParentId.value = node?.parentId ?? ''
  treeDeleteArmed.value = false
})
watch(newKind, (kind) => {
  if (kind === 'volume') newParentId.value = ''
})

const runAction = async (operation: () => Promise<void>) => {
  if (busy.value) return
  busy.value = true
  actionError.value = ''
  actionStatus.value = ''
  try {
    await operation()
  } catch {
    actionError.value = '操作未完成，请重试。'
  } finally {
    busy.value = false
  }
}

async function createItem() {
  const title = newTitle.value.trim()
  if (!title) {
    actionError.value = '请输入名称。'
    return
  }
  await runAction(async () => {
    const created = await session.createChapter({
      kind: newKind.value,
      parentId: newKind.value === 'chapter' && newParentId.value ? newParentId.value : null,
      title
    })
    if (!created) {
      actionError.value = session.error.value
      return
    }
    newTitle.value = ''
    actionStatus.value = newKind.value === 'volume' ? '分卷已创建。' : '章节已创建。'
  })
}

async function renameActive() {
  const title = activeTitle.value.trim()
  if (!title || title === session.activeChapter.value?.title) return
  await runAction(async () => {
    if (await session.renameActive(title)) actionStatus.value = '章节名称已更新。'
    else actionError.value = session.error.value
  })
}

async function removeActive() {
  if (!deleteArmed.value) {
    deleteArmed.value = true
    actionStatus.value = '再次点击以确认删除；草稿及全部版本将永久删除，此操作不可撤销。'
    return
  }
  await runAction(async () => {
    if (await session.removeActive()) actionStatus.value = '章节已删除。'
    else actionError.value = session.error.value
  })
}

async function selectTreeChapter(chapterId: string) {
  if (await session.selectChapter(chapterId)) selectedNodeId.value = chapterId
}

async function renameSelected() {
  const node = selectedNode.value
  const title = selectedNodeTitle.value.trim()
  if (node === null || !title || title === node.title) return
  await runAction(async () => {
    if (await session.renameNode(node.id, title)) {
      actionStatus.value = node.kind === 'volume' ? '分卷名称已更新。' : '章节名称已更新。'
    } else actionError.value = session.error.value
  })
}

async function moveSelected(offset: -1 | 1) {
  const node = selectedNode.value
  const position = selectedIndex.value + offset
  if (node === null || position < 0 || position >= selectedSiblings.value.length) return
  await runAction(async () => {
    if (await session.moveNode(node.id, node.parentId, position)) actionStatus.value = '选中项顺序已更新。'
    else actionError.value = session.error.value
  })
}

async function reparentSelected() {
  const node = selectedNode.value
  if (node === null || node.kind !== 'chapter') return
  const parentId = selectedParentId.value || null
  if (parentId === node.parentId) return
  const position = session.chapters.value.filter((chapter) => chapter.parentId === parentId).length
  await runAction(async () => {
    if (await session.moveNode(node.id, parentId, position)) actionStatus.value = '章节所属分卷已更新。'
    else actionError.value = session.error.value
  })
}

async function removeSelected() {
  const node = selectedNode.value
  if (node === null) return
  if (!treeDeleteArmed.value) {
    treeDeleteArmed.value = true
    actionStatus.value = node.kind === 'volume'
      ? '再次点击确认删除空分卷；非空分卷需先移动其中章节。'
      : '再次点击确认删除章节；草稿及全部版本将永久删除。'
    return
  }
  await runAction(async () => {
    if (!await session.removeNode(node.id)) {
      actionError.value = session.error.value
      return
    }
    selectedNodeId.value = session.activeChapter.value?.id ?? ''
    actionStatus.value = node.kind === 'volume' ? '分卷已删除。' : '章节已删除。'
  })
}

async function loadVersions() {
  const chapterId = session.activeChapter.value?.id
  if (chapterId === undefined) return
  const result = await window.openNovel.chapters.listVersions(chapterId)
  if (result.ok) versions.value = result.data
  else actionError.value = '无法读取版本历史。'
}

async function openPanel(next: 'versions' | 'transfer') {
  panel.value = panel.value === next ? null : next
  if (panel.value === 'versions') await loadVersions()
}

async function confirmVersion() {
  const chapterId = session.activeChapter.value?.id
  if (chapterId === undefined) return
  await runAction(async () => {
    if (!await session.flush()) {
      actionError.value = session.error.value
      return
    }
    const result = await window.openNovel.chapters.confirmVersion(chapterId)
    if (!result.ok) {
      actionError.value = '无法确认当前版本。'
      return
    }
    actionStatus.value = '当前正文已确认为不可变版本。'
    await loadVersions()
  })
}

async function restoreVersion(versionId: string) {
  const chapterId = session.activeChapter.value?.id
  if (chapterId === undefined) return
  if (restoreArmedId.value !== versionId) {
    restoreArmedId.value = versionId
    actionStatus.value = '恢复会替换当前可编辑草稿；系统会先保存最新正文。再次点击确认恢复。'
    return
  }
  await runAction(async () => {
    restoreArmedId.value = null
    if (!await session.restoreVersion(versionId)) {
      actionError.value = session.error.value
      return
    }
    actionStatus.value = '所选版本已恢复为新的可编辑草稿。'
    await loadVersions()
  })
}

async function previewPaste() {
  if (!importText.value.trim()) {
    actionError.value = '请粘贴需要导入的内容。'
    return
  }
  await preview({ mode: importMode.value, text: importText.value, sourceName: '粘贴内容' })
}

async function previewFile() {
  await preview({ mode: importMode.value, text: null, sourceName: null })
}

async function preview(input: { mode: ImportMode; text: string | null; sourceName: string | null }) {
  await runAction(async () => {
    const result = await window.openNovel.chapters.previewImport(input)
    if (!result.ok) {
      actionError.value = '无法读取导入内容，请确认文件为 UTF-8 TXT 或 Markdown。'
      return
    }
    importPreview.value = result.data
    actionStatus.value = result.data === null ? '已取消文件选择。' : '预览已生成，确认前不会写入工程。'
  })
}

async function confirmImport() {
  if (importPreview.value === null) return
  await runAction(async () => {
    const result = await window.openNovel.chapters.confirmImport(importPreview.value!)
    if (!result.ok) {
      actionError.value = '导入确认失败，工程未写入不完整内容。'
      return
    }
    importPreview.value = null
    importText.value = ''
    await session.refreshTree()
    actionStatus.value = '导入已完成。'
  })
}

async function exportBook(format: ExportFormat) {
  await runAction(async () => {
    if (!await session.flush()) {
      actionError.value = session.error.value
      return
    }
    const result = await window.openNovel.chapters.exportBook(format)
    if (!result.ok) {
      actionError.value = '导出未完成，请检查保存位置后重试。'
      return
    }
    actionStatus.value = result.data === null ? '已取消导出。' : `已导出 ${result.data.chapterCount} 章。`
  })
}

onMounted(async () => {
  unregisterFlush = registerWorkspaceFlush(session.flush)
  removeBeforeUnload = installBeforeUnloadFlush(window, () => session.dirty.value, session.flush)
  await session.initialize()
  if (panel.value === 'versions') await loadVersions()
})

onBeforeUnmount(() => {
  const finalFlush = session.flush()
  unregisterFlush?.()
  removeBeforeUnload?.()
  void finalFlush.finally(session.dispose)
})
</script>

<template>
  <main class="chapter-workspace">
    <a class="chapter-skip-link" href="#chapter-writing-surface">跳到正文编辑器</a>
    <aside class="chapter-tree-panel">
      <header>
        <div>
          <span class="eyebrow">MANUSCRIPT</span>
          <h1>章节</h1>
        </div>
        <span class="chapter-count">{{ session.chapters.value.filter((item) => item.kind === 'chapter').length }} 章</span>
      </header>

      <form data-testid="new-chapter-form" class="chapter-create" @submit.prevent="createItem">
        <label for="new-chapter-kind">新增内容</label>
        <div>
          <select id="new-chapter-kind" v-model="newKind" :disabled="busy">
            <option value="chapter">章节</option>
            <option value="volume">分卷</option>
          </select>
          <select v-if="newKind === 'chapter'" v-model="newParentId" aria-label="所属分卷" :disabled="busy">
            <option value="">不归入分卷</option>
            <option v-for="volume in volumes" :key="volume.id" :value="volume.id">{{ volume.title }}</option>
          </select>
          <input
            v-model="newTitle"
            data-testid="new-chapter-title"
            aria-label="新章节或分卷名称"
            maxlength="120"
            placeholder="输入名称"
            :disabled="busy"
          />
          <button type="submit" :disabled="busy">新增</button>
        </div>
      </form>

      <nav aria-label="章节树" class="chapter-tree">
        <p v-if="session.loading.value" role="status">正在读取章节…</p>
        <p v-else-if="rootItems.length === 0" class="chapter-tree__empty">还没有章节，从上方创建第一章。</p>
        <template v-for="item in rootItems" :key="item.id">
          <button
            v-if="item.kind === 'volume'"
            type="button"
            class="chapter-tree__volume"
            :class="{ 'chapter-tree__volume--active': selectedNodeId === item.id }"
            :aria-pressed="selectedNodeId === item.id"
            :data-testid="`tree-node-${item.id}`"
            :disabled="busy || session.transitioning.value"
            @click="selectedNodeId = item.id"
          >
            <strong>{{ item.title }}</strong>
            <span>{{ childrenOf(item.id).length }} 章</span>
          </button>
          <button
            v-else
            type="button"
            class="chapter-tree__item"
            :class="{ 'chapter-tree__item--active': session.activeChapter.value?.id === item.id }"
            :aria-current="session.activeChapter.value?.id === item.id ? 'page' : undefined"
            :disabled="busy || session.transitioning.value"
            @click="selectTreeChapter(item.id)"
          >
            <span>{{ item.title }}</span><small>第 {{ item.position + 1 }} 位</small>
          </button>
          <button
            v-for="child in item.kind === 'volume' ? childrenOf(item.id) : []"
            :key="child.id"
            type="button"
            class="chapter-tree__item chapter-tree__item--nested"
            :class="{ 'chapter-tree__item--active': session.activeChapter.value?.id === child.id }"
            :aria-current="session.activeChapter.value?.id === child.id ? 'page' : undefined"
            :disabled="busy || session.transitioning.value"
            @click="selectTreeChapter(child.id)"
          >
            <span>{{ child.title }}</span><small>第 {{ child.position + 1 }} 位</small>
          </button>
        </template>
      </nav>

      <section v-if="selectedNode" class="tree-organizer" aria-label="章节树组织工具">
        <label for="selected-node-title">选中{{ selectedNode.kind === 'volume' ? '分卷' : '章节' }}</label>
        <input
          id="selected-node-title"
          v-model="selectedNodeTitle"
          aria-label="选中项名称"
          maxlength="120"
          :disabled="busy"
          @keydown.enter.prevent="renameSelected"
        />
        <button type="button" :disabled="busy || !selectedNodeTitle.trim()" @click="renameSelected">重命名选中项</button>
        <div class="tree-organizer__row">
          <button type="button" :disabled="busy || !canMoveSelectedUp" @click="moveSelected(-1)">上移选中项</button>
          <button type="button" :disabled="busy || !canMoveSelectedDown" @click="moveSelected(1)">下移选中项</button>
        </div>
        <template v-if="selectedNode.kind === 'chapter'">
          <select v-model="selectedParentId" aria-label="移动章节到分卷" :disabled="busy">
            <option value="">不归入分卷</option>
            <option v-for="volume in volumes" :key="volume.id" :value="volume.id">{{ volume.title }}</option>
          </select>
          <button type="button" :disabled="busy || selectedParentId === (selectedNode.parentId ?? '')" @click="reparentSelected">
            移动到所选分卷
          </button>
        </template>
        <button type="button" class="danger-button" :disabled="busy" @click="removeSelected">
          {{ treeDeleteArmed ? '确认删除选中项' : '删除选中项' }}
        </button>
      </section>
    </aside>

    <section id="chapter-writing-surface" class="chapter-writing" tabindex="-1">
      <header class="chapter-writing__header">
        <div class="chapter-title-field">
          <label for="active-chapter-title">当前章节</label>
          <input
            id="active-chapter-title"
            v-model="activeTitle"
            data-testid="chapter-editor-heading"
            maxlength="120"
            :disabled="session.activeChapter.value === null || busy"
            @blur="renameActive"
            @keydown.enter.prevent="renameActive"
          />
        </div>
        <div class="chapter-writing__status">
          <span :class="`save-state save-state--${session.saveState.value}`" role="status">{{ saveLabel }}</span>
          <span>{{ characterCount }} 字</span>
        </div>
      </header>

      <div class="chapter-writing__actions" aria-label="章节操作">
        <button type="button" :disabled="session.activeChapter.value === null || busy" @click="session.moveActive(-1)">上移</button>
        <button type="button" :disabled="session.activeChapter.value === null || busy" @click="session.moveActive(1)">下移</button>
        <button type="button" :disabled="session.activeChapter.value === null || busy" @click="openPanel('versions')">版本</button>
        <button type="button" :aria-expanded="panel === 'transfer'" :disabled="busy" @click="openPanel('transfer')">导入</button>
        <button type="button" class="danger-button" :disabled="session.activeChapter.value === null || busy" @click="removeActive">
          {{ deleteArmed ? '确认删除' : '删除' }}
        </button>
      </div>

      <div v-if="actionStatus" class="chapter-feedback" role="status">{{ actionStatus }}</div>
      <div v-if="actionError || session.error.value" class="chapter-feedback chapter-feedback--error" role="alert">
        {{ actionError || session.error.value }}
      </div>

      <ChapterTextEditor
        :model-value="session.content.value"
        :read-only="session.activeChapter.value === null || busy || session.transitioning.value"
        :label="session.activeChapter.value ? `${session.activeChapter.value.title}正文` : '章节正文'"
        @update:model-value="session.updateContent"
      />
    </section>

    <aside v-if="panel" class="chapter-side-panel">
      <header>
        <div>
          <span class="eyebrow">{{ panel === 'versions' ? 'HISTORY' : 'TRANSFER' }}</span>
          <h2>{{ panel === 'versions' ? '版本历史' : '导入与导出' }}</h2>
        </div>
        <button type="button" aria-label="关闭侧栏" @click="panel = null">关闭</button>
      </header>

      <section v-if="panel === 'versions'" aria-label="版本历史" class="version-panel">
        <button type="button" class="panel-primary" :disabled="session.activeChapter.value === null || busy" @click="confirmVersion">
          确认当前版本
        </button>
        <p v-if="versions.length === 0" class="panel-empty">尚无已确认版本。</p>
        <article v-for="version in versions" :key="version.id" class="version-card">
          <div><strong>{{ versionStatusLabel(version.status) }}</strong><span>{{ new Date(version.createdAt).toLocaleString('zh-CN') }}</span></div>
          <p>{{ version.characterCount }} 字 · {{ version.content.slice(0, 42) || '空白正文' }}</p>
          <div class="version-card__actions">
            <button type="button" :aria-pressed="previewVersion?.id === version.id" @click="previewVersion = version">预览此版本</button>
            <button type="button" :disabled="busy || session.transitioning.value" @click="restoreVersion(version.id)">
              {{ restoreArmedId === version.id ? '确认恢复此版本' : '恢复此版本' }}
            </button>
          </div>
        </article>
        <div v-if="previewVersion" class="version-preview">
          <strong>只读预览</strong>
          <ChapterTextEditor
            :model-value="previewVersion.content"
            read-only
            label="历史版本只读预览"
          />
        </div>
      </section>

      <section v-else class="transfer-panel">
        <label for="chapter-import-mode">导入方式</label>
        <select id="chapter-import-mode" v-model="importMode" :disabled="busy">
          <option value="split-chapters">按标题拆分章节</option>
          <option value="single-chapter">导入为单章</option>
          <option value="reference">仅存为参考资料</option>
        </select>
        <label for="chapter-import-text">粘贴 UTF-8 文本或 Markdown</label>
        <textarea id="chapter-import-text" v-model="importText" rows="7" :disabled="busy" />
        <div class="panel-actions">
          <button type="button" :disabled="busy" @click="previewPaste">预览粘贴内容</button>
          <button type="button" :disabled="busy" @click="previewFile">选择 TXT / Markdown</button>
        </div>
        <article v-if="importPreview" data-testid="import-preview" class="import-preview">
          <strong>导入预览 · {{ importPreview.sourceName }}</strong>
          <p v-if="importPreview.mode === 'reference'">参考资料，不会创建正文。</p>
          <ul v-else>
            <li v-for="chapter in importPreview.chapters" :key="chapter.title">
              {{ chapter.title }} · {{ chapter.characterCount }} 字
            </li>
          </ul>
          <button type="button" class="panel-primary" :disabled="busy" @click="confirmImport">确认导入</button>
        </article>
        <hr />
        <strong>导出整本小说</strong>
        <div class="panel-actions panel-actions--exports">
          <button type="button" :disabled="busy" @click="exportBook('txt')">导出 TXT</button>
          <button type="button" :disabled="busy" @click="exportBook('markdown')">导出 Markdown</button>
          <button type="button" :disabled="busy" @click="exportBook('docx')">导出 DOCX</button>
        </div>
      </section>
    </aside>
  </main>
</template>

<style scoped>
.chapter-workspace {
  display: grid;
  grid-template-columns: 258px minmax(440px, 1fr) auto;
  min-height: calc(100vh - 70px);
  color: var(--project-ink);
  background: var(--project-paper);
}

.chapter-skip-link {
  position: fixed;
  top: 8px;
  left: 250px;
  z-index: 200;
  padding: 10px 14px;
  color: white;
  background: var(--project-accent-dark);
  transform: translateY(-160%);
}
.chapter-skip-link:focus { transform: translateY(0); }

.chapter-tree-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border-right: 1px solid var(--project-line);
  background: rgba(255, 250, 242, 0.9);
}
.chapter-tree-panel > header,
.chapter-side-panel > header {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--project-line);
}
.chapter-tree-panel h1,
.chapter-side-panel h2 { margin: 3px 0 0; font-family: "Noto Serif SC", "Songti SC", serif; }
.chapter-tree-panel h1 { font-size: 1.45rem; }
.chapter-side-panel h2 { font-size: 1.15rem; }
.chapter-count { color: var(--project-muted); font-size: .76rem; }

.chapter-create { display: grid; gap: 6px; padding: 14px; border-bottom: 1px solid var(--project-line); }
.chapter-create label,
.transfer-panel label { color: var(--project-muted); font-size: .78rem; font-weight: 750; }
.chapter-create > div { display: grid; grid-template-columns: 70px minmax(92px, .75fr) minmax(0, 1fr) auto; gap: 5px; }
select, input, textarea {
  min-height: 44px;
  border: 1px solid #cbb797;
  border-radius: 8px;
  color: var(--project-ink);
  background: #fffefb;
}
select, input { padding: 8px; }
textarea { padding: 10px; resize: vertical; line-height: 1.6; }
button {
  min-height: 44px;
  border: 1px solid var(--project-line);
  border-radius: 8px;
  color: var(--project-ink);
  background: #fffefb;
  transition: 180ms ease;
}
button:not(:disabled):hover { border-color: var(--project-accent); color: var(--project-accent-dark); background: var(--project-accent-soft); }
button:disabled { opacity: .48; }

.chapter-tree { display: grid; gap: 4px; overflow: auto; padding: 10px; }
.chapter-tree__empty { padding: 22px 10px; color: var(--project-muted); line-height: 1.6; }
.chapter-tree__volume { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 12px 9px; border-color: transparent; text-align: left; background: transparent; }
.chapter-tree__volume span { color: var(--project-muted); font-size: .72rem; }
.chapter-tree__volume--active { border-color: #c59a64; color: var(--project-accent-dark); background: var(--project-accent-soft); }
.chapter-tree__item { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; text-align: left; }
.chapter-tree__item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-tree__item small { color: var(--project-muted); white-space: nowrap; }
.chapter-tree__item--nested { margin-left: 16px; }
.chapter-tree__item--active { border-color: #c59a64; color: var(--project-accent-dark); background: var(--project-accent-soft); box-shadow: inset 3px 0 var(--project-accent); }
.tree-organizer { display: grid; gap: 7px; margin-top: auto; padding: 12px; border-top: 1px solid var(--project-line); background: rgba(255, 254, 251, .92); }
.tree-organizer label { color: var(--project-muted); font-size: .76rem; font-weight: 750; }
.tree-organizer__row { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

.chapter-writing { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); min-width: 0; min-height: 0; background: #fffefb; }
.chapter-writing__header { display: flex; min-height: 78px; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 22px; }
.chapter-title-field { display: grid; flex: 1; gap: 4px; }
.chapter-title-field label { color: var(--project-muted); font-size: .72rem; font-weight: 750; }
.chapter-title-field input { max-width: 560px; border-color: transparent; font-family: "Noto Serif SC", "Songti SC", serif; font-size: 1.35rem; font-weight: 750; background: transparent; }
.chapter-title-field input:hover,
.chapter-title-field input:focus { border-color: var(--project-line); background: var(--project-surface); }
.chapter-writing__status { display: flex; align-items: center; gap: 10px; color: var(--project-muted); font-size: .78rem; white-space: nowrap; }
.save-state { padding: 5px 8px; border-radius: 999px; background: #f2eee7; }
.save-state--saved { color: var(--project-success); background: #edf6f0; }
.save-state--conflict,
.save-state--error { color: var(--project-danger); background: var(--project-danger-soft); }
.chapter-writing__actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 10px; }
.chapter-writing__actions button { padding: 7px 12px; }
.danger-button { color: var(--project-danger); }
.chapter-feedback { margin: 0 20px 10px; padding: 9px 12px; border-radius: 8px; color: var(--project-success); background: #edf6f0; }
.chapter-feedback--error { color: var(--project-danger); background: var(--project-danger-soft); }

.chapter-side-panel { width: min(340px, 32vw); border-left: 1px solid var(--project-line); background: var(--project-surface); }
.chapter-side-panel > header button { padding: 7px 10px; }
.version-panel,
.transfer-panel { display: grid; gap: 11px; max-height: calc(100vh - 148px); overflow: auto; padding: 16px; }
.panel-primary { color: #fff; background: var(--project-accent-dark); }
.panel-primary:not(:disabled):hover { color: #fff; background: #613206; }
.panel-empty { color: var(--project-muted); }
.version-card,
.import-preview { padding: 13px; border: 1px solid var(--project-line); border-radius: 10px; background: #fffefb; }
.version-card div { display: flex; justify-content: space-between; gap: 8px; }
.version-card span,
.version-card p,
.import-preview p,
.import-preview li { color: var(--project-muted); font-size: .78rem; line-height: 1.55; }
.version-card__actions { display: grid !important; grid-template-columns: 1fr 1fr; gap: 6px; }
.version-card button { width: 100%; }
.version-preview { display: grid; gap: 8px; }
.version-preview :deep(.chapter-text-editor) { grid-template-rows: auto 260px; border: 1px solid var(--project-line); border-radius: 9px; overflow: hidden; }
.panel-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.panel-actions--exports { grid-template-columns: 1fr; }
.transfer-panel hr { width: 100%; border: 0; border-top: 1px solid var(--project-line); }

@media (max-width: 1120px) {
  .chapter-workspace { grid-template-columns: 220px minmax(400px, 1fr); }
  .chapter-side-panel { position: fixed; top: 70px; right: 0; bottom: 0; z-index: 30; width: min(380px, 88vw); box-shadow: -18px 0 42px rgba(74, 51, 24, .14); }
}
@media (max-width: 760px) {
  .chapter-workspace { grid-template-columns: 1fr; }
  .chapter-tree-panel { max-height: 310px; border-right: 0; border-bottom: 1px solid var(--project-line); }
  .chapter-writing { min-height: 620px; }
  .chapter-writing__header { align-items: flex-start; flex-direction: column; }
  .chapter-writing__status { align-self: stretch; justify-content: space-between; }
  .chapter-skip-link { left: 8px; }
  .chapter-create > div { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  button, .chapter-skip-link { transition: none; }
}
</style>
