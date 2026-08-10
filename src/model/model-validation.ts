import { ModelDomainError } from '../shared/model.ts'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key'
]

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' ||
    normalized === '[::1]' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
}

const invalidBaseUrl = (cause?: unknown): ModelDomainError => new ModelDomainError(
  'MODEL_INVALID_BASE_URL',
  'Provider URL must use HTTPS, except for an explicit loopback HTTP address',
  cause === undefined ? {} : { cause }
)

export const validateProviderBaseUrl = (value: string): URL => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (error) {
    throw invalidBaseUrl(error)
  }
  if (parsed.username !== '' || parsed.password !== '') throw invalidBaseUrl()
  if (parsed.protocol === 'https:') return parsed
  if (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname)) return parsed
  throw invalidBaseUrl()
}

const requestUrl = (input: RequestInfo | URL): URL => {
  if (input instanceof URL) return new URL(input.href)
  if (typeof input === 'string') return new URL(input)
  return new URL(input.url)
}

const requestHeaders = (input: RequestInfo | URL, init?: RequestInit): Headers => {
  if (init?.headers !== undefined) return new Headers(init.headers)
  return typeof Request !== 'undefined' && input instanceof Request
    ? new Headers(input.headers)
    : new Headers()
}

export const createSecureRedirectFetch = (
  fetchImplementation: typeof fetch = fetch,
  maximumRedirects = 3
): typeof fetch => async (input, init) => {
  let current = validateProviderBaseUrl(requestUrl(input).href)
  let headers = requestHeaders(input, init)
  let method = init?.method ?? (
    typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'
  )
  let body = init?.body

  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImplementation(current, {
      ...init,
      method,
      body,
      headers,
      redirect: 'manual'
    })
    if (!REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    if (location === null) return response
    await response.body?.cancel().catch(() => undefined)
    if (redirects >= maximumRedirects) throw invalidBaseUrl()

    const next = validateProviderBaseUrl(new URL(location, current).href)
    if (current.protocol === 'https:' && next.protocol !== 'https:') {
      throw invalidBaseUrl()
    }
    if (current.origin !== next.origin) {
      headers = new Headers(headers)
      for (const name of SENSITIVE_HEADERS) headers.delete(name)
    }
    if (response.status === 303 || (
      (response.status === 301 || response.status === 302) && method.toUpperCase() === 'POST'
    )) {
      method = 'GET'
      body = undefined
      headers = new Headers(headers)
      headers.delete('content-length')
      headers.delete('content-type')
    }
    current = next
  }
}
