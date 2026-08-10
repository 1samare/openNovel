<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { APP_DESCRIPTION, APP_NAME } from '@shared/app'
import { useProjectCenter } from '../project/use-project-center'
import { setActiveProject } from '../project/use-workspace-project'

const router = useRouter()
const {
  actionStatus,
  busyAction,
  createProject,
  error,
  isBusy,
  load,
  loading,
  openExisting,
  openRecent,
  recentProjects,
  removeRecent,
  restoreBackup,
  retryAvailable,
  showCreateForm,
  title,
  titleError
} = useProjectCenter(window.openNovel.projects, (project) => {
  setActiveProject(project)
  void router.push('/workspace/overview')
})

const formatOpenedAt = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value))

onMounted(() => {
  void load()
})
</script>

<template>
  <main class="project-center">
    <header class="project-center__header">
      <div class="brand-mark" aria-hidden="true">N</div>
      <div>
        <strong>{{ APP_NAME }}</strong>
        <p>{{ APP_DESCRIPTION }}</p>
      </div>
    </header>

    <section class="project-hero" aria-labelledby="project-center-title">
      <div class="project-hero__copy">
        <span class="eyebrow">LOCAL-FIRST WRITING</span>
        <h1 id="project-center-title">让每部长篇小说，都拥有独立项目</h1>
        <p>
          项目、正文与备份都保存在你选择的本地目录。离线也能写作，移除最近记录不会删除任何项目文件。
        </p>
      </div>

      <div class="project-hero__actions" aria-label="项目操作">
        <button
          class="project-button project-button--primary"
          type="button"
          :disabled="isBusy"
          @click="showCreateForm = true"
        >
          新建小说项目
        </button>
        <button
          class="project-button project-button--secondary"
          type="button"
          :disabled="isBusy"
          @click="openExisting"
        >
          打开已有项目
        </button>
        <button
          class="project-button project-button--quiet"
          type="button"
          :disabled="isBusy"
          @click="restoreBackup()"
        >
          从备份恢复
        </button>
      </div>
    </section>

    <section v-if="showCreateForm" class="project-create-panel" aria-labelledby="create-project-title">
      <div>
        <span class="eyebrow">CREATE PROJECT</span>
        <h2 id="create-project-title">新建小说项目</h2>
        <p>输入名称后选择一个空目录，应用会在其中建立完整项目结构。</p>
      </div>
      <form @submit.prevent="createProject">
        <label for="project-title">小说名称</label>
        <input
          id="project-title"
          v-model="title"
          type="text"
          maxlength="120"
          autocomplete="off"
          :aria-invalid="Boolean(titleError)"
          aria-describedby="project-title-help project-title-error"
          :disabled="isBusy"
        />
        <p id="project-title-help" class="field-help">例如：星海来信。名称稍后仍可修改。</p>
        <p
          v-if="titleError"
          id="project-title-error"
          class="field-error"
          data-testid="title-error"
          role="alert"
        >
          {{ titleError }}
        </p>
        <div class="project-create-panel__actions">
          <button class="project-button project-button--primary" type="submit" :disabled="isBusy">
            {{ busyAction === 'creating' ? '正在创建…' : '选择目录并创建' }}
          </button>
          <button
            class="project-button project-button--quiet"
            type="button"
            :disabled="isBusy"
            @click="showCreateForm = false"
          >
            取消
          </button>
        </div>
      </form>
    </section>

    <p v-if="actionStatus" class="project-action-status" role="status">{{ actionStatus }}</p>

    <section class="recent-projects" aria-labelledby="recent-projects-title">
      <div class="recent-projects__heading">
        <div>
          <span class="eyebrow">RECENT PROJECTS</span>
          <h2 id="recent-projects-title">最近项目</h2>
        </div>
        <span v-if="recentProjects.length" class="recent-projects__count">
          {{ recentProjects.length }} 个项目
        </span>
      </div>

      <div v-if="loading" class="project-feedback" role="status">
        <span class="project-feedback__spinner" aria-hidden="true"></span>
        正在读取最近项目…
      </div>

      <div v-else-if="error && retryAvailable" class="project-feedback project-feedback--error" role="alert">
        <div>
          <strong>最近项目暂时无法读取</strong>
          <p>{{ error }}</p>
        </div>
        <button class="project-button project-button--secondary" type="button" :disabled="isBusy" @click="load">
          重试
        </button>
      </div>

      <div v-else-if="!recentProjects.length" class="project-empty" data-testid="project-empty">
        <svg aria-hidden="true" viewBox="0 0 64 64" fill="none">
          <path d="M14 12h28a8 8 0 0 1 8 8v32H22a8 8 0 0 1-8-8V12Z" />
          <path d="M22 52a8 8 0 0 1 0-16h28M26 22h14M26 28h10" />
        </svg>
        <h3>还没有最近项目</h3>
        <p>新建一个项目开始写作，或打开已经存在的本地项目目录。</p>
      </div>

      <div v-else class="project-list">
        <article v-for="project in recentProjects" :key="project.projectId" class="project-card">
          <div class="project-card__body">
            <div class="project-card__title-row">
              <h3>{{ project.title }}</h3>
              <span :class="['project-availability', { 'project-availability--missing': !project.pathAvailable }]">
                {{ project.pathAvailable ? '可打开' : '路径不可用' }}
              </span>
            </div>
            <p class="project-card__path" :title="project.projectPath">{{ project.projectPath }}</p>
            <p class="project-card__time">上次打开：{{ formatOpenedAt(project.lastOpenedAt) }}</p>
          </div>
          <div class="project-card__actions">
            <button
              v-if="project.pathAvailable"
              class="project-button project-button--primary"
              type="button"
              :aria-label="`打开 ${project.title}`"
              :disabled="isBusy"
              @click="openRecent(project.projectId)"
            >
              打开
            </button>
            <template v-else>
              <button
                class="project-button project-button--secondary"
                type="button"
                :aria-label="`重新定位 ${project.title}`"
                :disabled="isBusy"
                @click="openExisting"
              >
                重新定位
              </button>
              <button
                class="project-button project-button--secondary"
                type="button"
                :aria-label="`从备份恢复 ${project.title}`"
                :disabled="isBusy"
                @click="restoreBackup()"
              >
                恢复备份
              </button>
            </template>
            <button
              class="project-button project-button--quiet"
              type="button"
              :aria-label="`仅移除记录 ${project.title}`"
              :disabled="isBusy"
              @click="removeRecent(project.projectId)"
            >
              仅移除记录
            </button>
          </div>
        </article>
      </div>
    </section>

    <div v-if="error && !retryAvailable" class="project-toast" role="alert">
      <strong>操作未完成</strong>
      <p>{{ error }}</p>
    </div>
  </main>
</template>
