const DEFAULT_HOST = '127.0.0.1'

export const buildCdpEndpoint = (host, port, route = '/json/list') => {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  return `http://${host}:${port}${normalizedRoute}`
}

export const findPageTarget = (targets) => {
  const target = Array.isArray(targets)
    ? targets.find((candidate) => candidate?.type === 'page' &&
      typeof candidate.url === 'string' &&
      typeof candidate.webSocketDebuggerUrl === 'string')
    : undefined
  if (target === undefined) throw new Error('CDP page target was not found')
  return target
}

const parseMessage = (data) => {
  if (typeof data === 'string') return JSON.parse(data)
  if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data))
  if (ArrayBuffer.isView(data)) return JSON.parse(new TextDecoder().decode(data))
  return JSON.parse(String(data))
}

export class CdpClient {
  #socket
  #nextId = 1
  #pending = new Map()
  #listeners = new Map()

  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => this.#handleMessage(event.data))
    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error('CDP connection closed'))
      }
      this.#pending.clear()
    })
    socket.addEventListener('error', () => undefined)
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  call(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      try {
        this.#socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        this.#pending.delete(id)
        reject(error)
      }
    })
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    })
    if (response.exceptionDetails !== undefined) {
      throw new Error('CDP page evaluation failed')
    }
    return response.result?.value
  }

  close() {
    try {
      this.#socket.close()
    } catch {
      // The connection may already be closed during app shutdown.
    }
  }

  #handleMessage(data) {
    let message
    try {
      message = parseMessage(data)
    } catch {
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id)
      if (pending === undefined) return
      this.#pending.delete(message.id)
      if (message.error !== undefined) {
        pending.reject(new Error(`CDP ${message.error.code ?? 'error'}`))
      } else {
        pending.resolve(message.result ?? {})
      }
      return
    }

    if (typeof message.method !== 'string') return
    for (const listener of this.#listeners.get(message.method) ?? []) {
      try {
        listener(message.params ?? {})
      } catch {
        // Diagnostics listeners must not break protocol delivery.
      }
    }
  }
}

export const fetchJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`CDP endpoint returned HTTP ${response.status}`)
  return response.json()
}

export const waitForPageTarget = async ({
  host = DEFAULT_HOST,
  port,
  timeoutMs = 30000,
  intervalMs = 100
}) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return findPageTarget(await fetchJson(buildCdpEndpoint(host, port)))
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  throw new Error(`Timed out waiting for CDP page target: ${lastError?.message ?? 'unknown error'}`)
}

export const connectCdp = async (webSocketUrl, { timeoutMs = 10000 } = {}) => {
  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to CDP')), timeoutMs)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('Unable to connect to CDP'))
    }, { once: true })
  })
  const client = new CdpClient(socket)
  await client.call('Runtime.enable')
  await client.call('Page.enable')
  return client
}
