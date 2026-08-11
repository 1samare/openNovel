<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import type { BibleEntry, BibleEntryDraft, BibleEntryKind, BibleField, SaveBibleEntryInput } from '@shared/novel'

const props = defineProps<{
  allowedKinds: BibleEntryKind[]
  selected: BibleEntry | null
  busy: boolean
  relationOptions: BibleEntry[]
}>()

const emit = defineEmits<{
  save: [input: SaveBibleEntryInput]
  cancel: []
}>()

const kindLabels: Record<BibleEntryKind, string> = {
  'world-setting': '世界规则', location: '地点', faction: '势力', item: '物品',
  character: '人物', relationship: '人物关系', 'character-state': '阶段状态',
  'timeline-event': '时间线事件', foreshadow: '伏笔'
}

const form = reactive<{
  kind: BibleEntryKind
  title: string
  summary: string
  fields: BibleField[]
  relatedEntityIds: string[]
}>({ kind: props.allowedKinds[0] as BibleEntryKind, title: '', summary: '', fields: [], relatedEntityIds: [] })

watch([() => props.selected, () => props.allowedKinds], ([selected]) => {
  form.kind = selected?.kind ?? props.allowedKinds[0]
  form.title = selected?.title ?? ''
  form.summary = selected?.summary ?? ''
  form.fields = selected?.fields.map((field) => ({ ...field })) ?? []
  form.relatedEntityIds = [...(selected?.relatedEntityIds ?? [])]
}, { immediate: true })

const requiredRelationCount = computed(() => form.kind === 'relationship' ? 2 : form.kind === 'character-state' ? 1 : 0)
const relationsValid = computed(() => form.relatedEntityIds.length >= requiredRelationCount.value)

const addField = (): void => {
  let index = form.fields.length + 1
  while (form.fields.some((field) => field.key === `detail-${index}`)) index += 1
  form.fields.push({ key: `detail-${index}`, label: '关键细节', value: '' })
}

const reset = (): void => {
  form.kind = props.allowedKinds[0]
  form.title = ''
  form.summary = ''
  form.fields = []
  form.relatedEntityIds = []
  emit('cancel')
}

const submit = (): void => {
  const draft: BibleEntryDraft = {
    kind: form.kind,
    title: form.title.trim(),
    summary: form.summary.trim(),
    fields: form.fields.map((field) => ({
      key: field.key.trim(), label: field.label.trim(), value: field.value
    })),
    relatedEntityIds: [...form.relatedEntityIds]
  }
  emit('save', {
    entryId: props.selected?.id ?? null,
    expectedVersionId: props.selected?.currentVersionId ?? null,
    draft
  })
}
</script>

<template>
  <form class="bible-form" data-testid="bible-entry-form" @submit.prevent="submit">
    <div class="bible-field">
      <label for="bible-entry-kind">资料类型</label>
      <select id="bible-entry-kind" v-model="form.kind" :disabled="busy || Boolean(selected)">
        <option v-for="kind in allowedKinds" :key="kind" :value="kind">{{ kindLabels[kind] }}</option>
      </select>
    </div>
    <div class="bible-field">
      <label for="bible-entry-title">标题</label>
      <input id="bible-entry-title" v-model="form.title" maxlength="160" required :disabled="busy" />
    </div>
    <div class="bible-field bible-field--wide">
      <label for="bible-entry-summary">摘要</label>
      <textarea id="bible-entry-summary" v-model="form.summary" rows="4" maxlength="20000" :disabled="busy" />
    </div>
    <fieldset v-if="requiredRelationCount > 0" class="bible-field bible-field--wide bible-relation-options">
      <legend>{{ form.kind === 'relationship' ? '关联人物（至少两人）' : '所属人物' }}</legend>
      <label v-for="option in relationOptions" :key="option.id">
        <input v-model="form.relatedEntityIds" name="bible-entry-relation" type="checkbox" :value="option.id" :disabled="busy" />
        {{ option.title }}
      </label>
      <p v-if="relationOptions.length === 0" class="bible-empty-inline">请先创建人物档案。</p>
    </fieldset>
    <fieldset class="bible-field bible-field--wide bible-structured-fields">
      <legend>结构化细节</legend>
      <div v-for="(field, index) in form.fields" :key="`${field.key}-${index}`" class="bible-structured-field">
        <label :for="`bible-field-key-${index}`">字段键</label>
        <input :id="`bible-field-key-${index}`" v-model="field.key" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64" :disabled="busy" />
        <label :for="`bible-field-label-${index}`">字段名称</label>
        <input :id="`bible-field-label-${index}`" v-model="field.label" required maxlength="80" :disabled="busy" />
        <label :for="`bible-field-value-${index}`">字段内容</label>
        <textarea :id="`bible-field-value-${index}`" v-model="field.value" rows="3" maxlength="10000" :disabled="busy" />
        <button class="bible-button bible-button--quiet" type="button" :disabled="busy" @click="form.fields.splice(index, 1)">删除此细节</button>
      </div>
      <button class="bible-button" type="button" :disabled="busy || form.fields.length >= 40" @click="addField">添加细节</button>
    </fieldset>
    <div class="bible-form__actions bible-field--wide">
      <button class="bible-button bible-button--primary" type="submit" :disabled="busy || !form.title.trim() || !relationsValid">
        {{ busy ? '正在保存…' : selected ? '保存修改' : '新增资料' }}
      </button>
      <button v-if="selected" class="bible-button bible-button--quiet" type="button" :disabled="busy" @click="reset">取消编辑</button>
    </div>
  </form>
</template>
