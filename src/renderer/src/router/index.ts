import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import WorkspaceLayout from '@renderer/layouts/WorkspaceLayout.vue'
import { navigationItems } from '@renderer/navigation/items'
import AgentHarnessView from '@renderer/views/AgentHarnessView.vue'
import ProjectCenterView from '@renderer/views/ProjectCenterView.vue'
import ChapterEditorView from '@renderer/views/ChapterEditorView.vue'
import ModelSettingsView from '@renderer/views/ModelSettingsView.vue'
import WorldBibleView from '@renderer/views/WorldBibleView.vue'
import CharacterBibleView from '@renderer/views/CharacterBibleView.vue'
import OutlineBibleView from '@renderer/views/OutlineBibleView.vue'
import WorkspacePlaceholderView from '@renderer/views/WorkspacePlaceholderView.vue'

const workspaceRoutes: RouteRecordRaw[] = navigationItems.filter((item) => ![
  'chat', 'world', 'characters', 'outline', 'chapters', 'versions', 'settings'
].includes(item.path)).map((item) => ({
  path: item.path,
  name: item.path,
  component: WorkspacePlaceholderView,
  props: {
    title: item.label,
    description: item.description
  }
}))

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'project-center',
      component: ProjectCenterView
    },
    {
      path: '/workspace',
      component: WorkspaceLayout,
      children: [
        { path: '', redirect: '/workspace/overview' },
        { path: 'chat', name: 'chat', component: AgentHarnessView },
        { path: 'world', name: 'world', component: WorldBibleView },
        { path: 'characters', name: 'characters', component: CharacterBibleView },
        { path: 'outline', name: 'outline', component: OutlineBibleView },
        { path: 'chapters', name: 'chapters', component: ChapterEditorView },
        { path: 'versions', name: 'versions', component: ChapterEditorView, props: { initialPanel: 'versions' } },
        { path: 'settings', name: 'settings', component: ModelSettingsView },
        ...workspaceRoutes
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

export default router
