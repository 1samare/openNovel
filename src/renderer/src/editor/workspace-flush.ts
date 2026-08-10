export type WorkspaceFlush = () => Promise<boolean>

const activeFlushers = new Set<WorkspaceFlush>()

export const registerWorkspaceFlush = (flush: WorkspaceFlush): (() => void) => {
  activeFlushers.add(flush)
  return () => activeFlushers.delete(flush)
}

export const flushWorkspaceEditors = async (): Promise<boolean> => {
  const results = await Promise.all([...activeFlushers].map(async (flush) => {
    try {
      return await flush()
    } catch {
      return false
    }
  }))
  return results.every(Boolean)
}

export const installBeforeUnloadFlush = (
  target: Window,
  isDirty: () => boolean,
  flush: WorkspaceFlush,
  close: () => void = () => target.close()
): (() => void) => {
  let active = true
  const remove = () => {
    if (!active) return
    active = false
    target.removeEventListener('beforeunload', handle)
  }
  const handle = (event: BeforeUnloadEvent) => {
    if (!active || !isDirty()) return
    event.preventDefault()
    event.returnValue = ''
    void flush().then((saved) => {
      if (!active || !saved) return
      remove()
      close()
    })
  }
  target.addEventListener('beforeunload', handle)
  return remove
}
