import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import WorkspaceLayout from '@renderer/layouts/WorkspaceLayout.vue'
import { navigationItems } from '@renderer/navigation/items'
import ProjectCenterView from '@renderer/views/ProjectCenterView.vue'
import WorkspacePlaceholderView from '@renderer/views/WorkspacePlaceholderView.vue'

const workspaceRoutes: RouteRecordRaw[] = navigationItems.map((item) => ({
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
        ...workspaceRoutes
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

export default router
