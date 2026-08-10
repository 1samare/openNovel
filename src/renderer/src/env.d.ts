/// <reference types="vite/client" />

import type { AgentApi } from '@shared/agent-ipc'
import type { ProjectApi } from '@shared/project'

declare global {
  interface Window {
    openNovel: {
      agent: AgentApi
      projects: ProjectApi
    }
  }
}

export {}
