/// <reference types="vite/client" />

import type { AgentApi } from '@shared/agent-ipc'
import type { ProjectApi } from '@shared/project'
import type { ChapterApi } from '@shared/chapter'
import type { RendererFlushApi } from '@shared/renderer-flush'

declare global {
  interface Window {
    openNovel: {
      agent: AgentApi
      projects: ProjectApi
      chapters: ChapterApi
      lifecycle: RendererFlushApi
    }
  }
}

export {}
