export type AgentSenderPolicy = {
  appPageUrl?: string
  devServerOrigin?: string
}

export type AgentIpcSender = {
  getURL(): string
  isDestroyed?(): boolean
  mainFrame?: AgentFrame | null
}

export type AgentFrame = {
  url: string
  isDestroyed?(): boolean
}

export type AgentIpcSenderEvent = {
  sender: AgentIpcSender
  senderFrame?: AgentFrame | null
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
  if (
    appPage !== undefined &&
    appPage.protocol === 'file:' &&
    appPage.username === '' &&
    appPage.password === '' &&
    appPage.search === '' &&
    candidate.protocol === 'file:' &&
    candidate.username === '' &&
    candidate.password === '' &&
    candidate.search === '' &&
    candidate.host === appPage.host &&
    candidate.pathname === appPage.pathname
  ) {
    return true
  }
  const devOrigin = parseUrl(policy.devServerOrigin)
  return devOrigin !== undefined &&
    (devOrigin.protocol === 'http:' || devOrigin.protocol === 'https:') &&
    devOrigin.username === '' &&
    devOrigin.password === '' &&
    candidate.username === '' &&
    candidate.password === '' &&
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
      event.sender.mainFrame === null ||
      senderFrame.isDestroyed?.() === true ||
      event.sender.mainFrame.isDestroyed?.() === true ||
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
