<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

const props = withDefaults(defineProps<{
  modelValue: string
  readOnly?: boolean
  label?: string
}>(), {
  readOnly: false,
  label: '章节正文'
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  selectionChange: [selection: { from: number; to: number; text: string }]
}>()

const host = ref<HTMLDivElement>()
const fullscreen = ref(false)
let view: EditorView | undefined
let composing = false
const editable = new Compartment()

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"Noto Serif SC", "Songti SC", SimSun, serif' },
  '.cm-content': { maxWidth: '760px', margin: '0 auto', padding: '42px clamp(28px, 7vw, 82px)', caretColor: '#78400c' },
  '.cm-line': { padding: '0', fontSize: '1.08rem', lineHeight: '2' },
  '.cm-focused': { outline: 'none' },
  '.cm-gutters': { display: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#f1d4ad' },
  '.cm-search': { borderTop: '1px solid #dfd0ba', backgroundColor: '#fffaf2' }
})

const currentText = () => view?.state.doc.toString() ?? ''

onMounted(() => {
  if (host.value === undefined) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        EditorView.lineWrapping,
        history(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        editable.of([
          EditorState.readOnly.of(props.readOnly),
          EditorView.editable.of(!props.readOnly)
        ]),
        EditorView.contentAttributes.of({ 'aria-label': props.label, role: 'textbox' }),
        EditorView.domEventHandlers({
          compositionstart: () => {
            composing = true
            return false
          },
          compositionend: () => {
            composing = false
            queueMicrotask(() => emit('update:modelValue', currentText()))
            return false
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !composing) emit('update:modelValue', update.state.doc.toString())
          if (update.docChanged || update.selectionSet) {
            const selection = update.state.selection.main
            emit('selectionChange', {
              from: selection.from,
              to: selection.to,
              text: update.state.sliceDoc(selection.from, selection.to)
            })
          }
        }),
        editorTheme
      ]
    })
  })
})

watch(() => props.modelValue, (next) => {
  if (view === undefined || composing || currentText() === next) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
})

watch(() => props.readOnly, (readOnly) => {
  if (view === undefined) return
  view.dispatch({
    effects: editable.reconfigure([
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly)
    ])
  })
})

const runCommand = (command: (target: EditorView) => boolean) => {
  if (view !== undefined) command(view)
  view?.focus()
}

const toggleFullscreen = () => {
  fullscreen.value = !fullscreen.value
  queueMicrotask(() => view?.focus())
}

const onEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && fullscreen.value) toggleFullscreen()
}

onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscape)
  view?.destroy()
})
</script>

<template>
  <section class="chapter-text-editor" :class="{ 'chapter-text-editor--fullscreen': fullscreen }" aria-label="正文编辑器">
    <div class="chapter-text-editor__toolbar" role="toolbar" aria-label="正文编辑工具">
      <button type="button" :disabled="readOnly" @click="runCommand(undo)">撤销</button>
      <button type="button" :disabled="readOnly" @click="runCommand(redo)">重做</button>
      <button type="button" aria-label="打开搜索与替换" @click="runCommand(openSearchPanel)">搜索与替换</button>
      <button type="button" :aria-pressed="fullscreen" @click="toggleFullscreen">
        {{ fullscreen ? '退出全屏' : '全屏写作' }}
      </button>
    </div>
    <div ref="host" class="chapter-text-editor__surface" />
  </section>
</template>

<style scoped>
.chapter-text-editor {
  display: grid;
  grid-template-rows: auto minmax(340px, 1fr);
  min-height: 0;
  border-top: 1px solid var(--project-line);
  background: #fffefb;
}

.chapter-text-editor--fullscreen {
  position: fixed;
  inset: 0;
  z-index: 100;
  grid-template-rows: auto minmax(0, 1fr);
  background: #fffefb;
}

.chapter-text-editor__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--project-line);
  background: var(--project-surface);
}

.chapter-text-editor__toolbar button {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--project-muted);
  background: transparent;
  transition: 180ms ease;
}

.chapter-text-editor__toolbar button:not(:disabled):hover,
.chapter-text-editor__toolbar button[aria-pressed='true'] {
  border-color: var(--project-line);
  color: var(--project-accent-dark);
  background: var(--project-accent-soft);
}

.chapter-text-editor__toolbar button:disabled {
  opacity: 0.45;
}

.chapter-text-editor__surface {
  min-height: 0;
  overflow: hidden;
}

.chapter-text-editor__surface :deep(.cm-editor) {
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .chapter-text-editor__toolbar button { transition: none; }
}
</style>
