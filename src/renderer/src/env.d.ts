/// <reference types="vite/client" />

import type { AgentApi } from '@shared/agent-ipc'
import type { ProjectApi } from '@shared/project'
import type { ChapterApi } from '@shared/chapter'
import type { RendererFlushApi } from '@shared/renderer-flush'
import type { ModelApi } from '@shared/model'

declare global {
  interface Window {
    openNovel: {
      agent: AgentApi
      projects: ProjectApi
      chapters: ChapterApi
      models: ModelApi
      lifecycle: RendererFlushApi
    }
  }
}

export {}
