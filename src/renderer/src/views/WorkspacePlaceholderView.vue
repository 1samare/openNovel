<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <main class="workspace-page">
    <header class="workspace-page__header">
      <div>
        <span class="eyebrow">MODULE FOUNDATION</span>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <span class="status-pill">架构占位</span>
    </header>

    <section class="placeholder-panel">
      <div class="placeholder-panel__symbol">{{ title.slice(0, 1) }}</div>
      <h2>{{ title }}模块已就位</h2>
      <p>当前仅提供页面入口和布局边界，不包含业务数据与操作。</p>
    </section>
  </main>
</template>
