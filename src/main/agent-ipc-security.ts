export type AgentSenderPolicy = {
  appPageUrl?: string
  devServerOrigin?: string
}

export type AgentIpcSender = {
  getURL(): string
  isDestroyed?(): boolean
  mainFrame?: unknown
}

export type AgentIpcSenderEvent = {
  sender: AgentIpcSender
  senderFrame?: { url: string } | null
}

export type AgentLiveWebContents = {
  getURL(): string
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

const parseUrl = (value: string | undefined): URL | undefined => {
  if (value === undefined) return undefined
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const isAllowedUrl = (value: string, policy: AgentSenderPolicy): boolean => {
  const candidate = parseUrl(value)
  if (candidate === undefined) return false
  const appPage = parseUrl(policy.appPageUrl)
  if (appPage !== undefined && appPage.protocol === 'file:' && candidate.href === appPage.href) {
    return true
  }
  const devOrigin = parseUrl(policy.devServerOrigin)
  return devOrigin !== undefined &&
    (devOrigin.protocol === 'http:' || devOrigin.protocol === 'https:') &&
    candidate.origin === devOrigin.origin
}

export const isAllowedAgentIpcSender = (
  event: AgentIpcSenderEvent,
  policy: AgentSenderPolicy
): boolean => {
  try {
    const senderFrame = event.senderFrame
    if (
      event.sender.isDestroyed?.() === true ||
      senderFrame === undefined ||
      senderFrame === null ||
      event.sender.mainFrame === undefined ||
      senderFrame !== event.sender.mainFrame
    ) return false
    const senderUrl = event.sender.getURL()
    return senderUrl === senderFrame.url && isAllowedUrl(senderUrl, policy)
  } catch {
    return false
  }
}

export const isAllowedLiveAgentWebContents = (
  webContents: AgentLiveWebContents,
  policy: AgentSenderPolicy
): boolean => {
  try {
    return !webContents.isDestroyed() && isAllowedUrl(webContents.getURL(), policy)
  } catch {
    return false
  }
}
