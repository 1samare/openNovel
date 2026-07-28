<script setup lang="ts">
import { APP_DESCRIPTION, APP_NAME } from '@shared/app'
</script>

<template>
  <main class="project-center">
    <header class="project-center__header">
      <div class="brand-mark">N</div>
      <div>
        <strong>{{ APP_NAME }}</strong>
        <p>{{ APP_DESCRIPTION }}</p>
      </div>
    </header>

    <section class="project-center__content">
      <div>
        <span class="eyebrow">DESKTOP FOUNDATION</span>
        <h1>把故事，写成一个完整世界</h1>
        <p class="project-center__intro">
          当前版本已建立桌面端进程边界、页面路由和创作工作台布局。
        </p>
        <RouterLink class="primary-link" to="/workspace/overview">进入架构预览</RouterLink>
      </div>

      <article class="empty-project-card">
        <div class="empty-project-card__icon">＋</div>
        <h2>项目中心</h2>
        <p>小说项目管理功能将在后续业务阶段接入。</p>
      </article>
    </section>
  </main>
</template>
