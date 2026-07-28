<script setup lang="ts">
import { APP_NAME } from '@shared/app'
import { navigationItems } from '@renderer/navigation/items'
</script>

<template>
  <div class="workspace-shell">
    <aside class="workspace-sidebar">
      <RouterLink class="workspace-brand" to="/">
        <span class="brand-mark brand-mark--small">N</span>
        <span>{{ APP_NAME }}</span>
      </RouterLink>

      <nav class="workspace-nav" aria-label="创作工作台导航">
        <RouterLink
          v-for="item in navigationItems"
          :key="item.path"
          class="workspace-nav__item"
          :to="`/workspace/${item.path}`"
        >
          <span class="workspace-nav__marker">{{ item.marker }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="workspace-sidebar__footer">
        <span>本地优先</span>
        <small>基础架构版本 0.1.0</small>
      </div>
    </aside>

    <section class="workspace-main">
      <header class="workspace-topbar">
        <div>
          <strong>创作工作台</strong>
          <span>未打开项目</span>
        </div>
        <RouterLink class="secondary-link" to="/">返回项目中心</RouterLink>
      </header>

      <RouterView />
    </section>
  </div>
</template>
