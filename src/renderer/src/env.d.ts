/// <reference types="vite/client" />

import type { AgentApi } from '@shared/agent-ipc'

declare global {
  interface Window {
    openNovel: {
      agent: AgentApi
    }
  }
}

export {}
