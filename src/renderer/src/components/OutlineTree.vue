<script setup lang="ts">
import { computed } from 'vue'
import type { OutlineNode } from '@shared/novel'

const props = defineProps<{ nodes: OutlineNode[]; selectedId: string | null; busy: boolean }>()
const emit = defineEmits<{
  select: [node: OutlineNode]
  move: [nodeId: string, direction: 'up' | 'down']
  versions: [node: OutlineNode]
}>()
const kindLabels: Record<OutlineNode['kind'], string> = { story: '总纲', volume: '分卷', stage: '阶段', 'chapter-plan': '章节' }
const flattened = computed(() => {
  const children = new Map<string | null, OutlineNode[]>()
  for (const node of props.nodes) {
    const group = children.get(node.parentId) ?? []
    group.push(node)
    children.set(node.parentId, group)
  }
  for (const group of children.values()) group.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
  const result: Array<{ node: OutlineNode; depth: number }> = []
  const visited = new Set<string>()
  const visit = (parentId: string | null, depth: number): void => {
    for (const node of children.get(parentId) ?? []) {
      if (visited.has(node.id)) continue
      visited.add(node.id)
      result.push({ node, depth })
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  for (const node of props.nodes) if (!visited.has(node.id)) result.push({ node, depth: 0 })
  return result
})
</script>

<template>
  <div class="outline-tree" role="tree" aria-label="小说分层大纲">
    <p v-if="nodes.length === 0" class="bible-empty-inline">尚无大纲。先新增故事总纲，再逐层添加分卷、阶段和章节规划。</p>
    <article v-for="item in flattened" :key="item.node.id" class="outline-tree__item" :class="{ 'outline-tree__item--selected': selectedId === item.node.id }" :style="{ '--outline-depth': item.depth }" role="treeitem" :aria-level="item.depth + 1" :aria-selected="selectedId === item.node.id">
      <button class="outline-tree__body" type="button" :disabled="busy" @click="emit('select', item.node)">
        <span>{{ kindLabels[item.node.kind] }}</span><strong>{{ item.node.title }}</strong><small>{{ item.node.summary || '尚未填写摘要' }}</small>
      </button>
      <div class="outline-tree__actions">
        <button type="button" :aria-label="`上移${item.node.title}`" :disabled="busy || item.node.position === 0" @click="emit('move', item.node.id, 'up')">↑</button>
        <button type="button" :aria-label="`下移${item.node.title}`" :disabled="busy" @click="emit('move', item.node.id, 'down')">↓</button>
        <button type="button" :aria-label="`查看${item.node.title}版本`" :disabled="busy" @click="emit('versions', item.node)">版本</button>
      </div>
    </article>
  </div>
</template>
