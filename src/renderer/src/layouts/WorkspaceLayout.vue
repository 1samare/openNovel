<script setup lang="ts">
import { useRouter } from 'vue-router'
import { APP_NAME } from '@shared/app'
import { navigationItems } from '@renderer/navigation/items'
import { useWorkspaceProject } from '../project/use-workspace-project'

const router = useRouter()
const {
  activeProject,
  backupProject,
  beginRename,
  busyAction,
  closeProject,
  error,
  isBusy,
  renameProject,
  showRenameForm,
  status,
  title,
  titleError
} = useWorkspaceProject(window.openNovel.projects, () => {
  void router.push('/')
})
</script>

<template>
  <div class="workspace-shell">
    <aside class="workspace-sidebar">
      <RouterLink class="workspace-brand" to="/workspace/overview" aria-label="返回工作台概览">
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
        <div class="workspace-project-context">
          <strong>{{ activeProject?.title ?? '创作工作台' }}</strong>
          <span>{{ activeProject ? '本地项目已打开' : '请从项目中心打开项目' }}</span>
        </div>
        <div class="workspace-project-actions" aria-label="当前项目操作">
          <button class="secondary-link" type="button" :disabled="isBusy || !activeProject" @click="beginRename">
            重命名
          </button>
          <button class="secondary-link" type="button" :disabled="isBusy || !activeProject" @click="backupProject">
            {{ busyAction === 'backing-up' ? '正在备份…' : '创建备份' }}
          </button>
          <button class="secondary-link" type="button" :disabled="isBusy || !activeProject" @click="closeProject">
            {{ busyAction === 'closing' ? '正在关闭…' : '关闭并返回项目中心' }}
          </button>
        </div>
      </header>

      <section v-if="showRenameForm" class="workspace-project-panel" aria-labelledby="rename-project-title">
        <div>
          <strong id="rename-project-title">重命名当前项目</strong>
          <p>名称会同步写入项目数据库与 manifest。</p>
        </div>
        <form data-testid="workspace-rename-form" @submit.prevent="renameProject">
          <label for="workspace-project-title">小说名称</label>
          <input
            id="workspace-project-title"
            v-model="title"
            type="text"
            maxlength="120"
            autocomplete="off"
            :disabled="isBusy"
            :aria-invalid="Boolean(titleError)"
            aria-describedby="workspace-project-title-error"
          />
          <p
            v-if="titleError"
            id="workspace-project-title-error"
            data-testid="workspace-title-error"
            class="field-error"
            role="alert"
          >
            {{ titleError }}
          </p>
          <div class="workspace-project-panel__actions">
            <button class="project-button project-button--primary" type="submit" :disabled="isBusy">
              {{ busyAction === 'renaming' ? '正在保存…' : '保存名称' }}
            </button>
            <button
              class="project-button project-button--quiet"
              type="button"
              :disabled="isBusy"
              @click="showRenameForm = false"
            >
              取消
            </button>
          </div>
        </form>
      </section>

      <p v-if="status" class="workspace-project-notice" role="status">{{ status }}</p>
      <div v-if="error" class="workspace-project-notice workspace-project-notice--error" role="alert">
        <strong>项目操作未完成</strong>
        <p>{{ error }}</p>
      </div>

      <RouterView />
    </section>
  </div>
</template>
