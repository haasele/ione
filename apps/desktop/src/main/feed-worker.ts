import { parseFeed } from '@ione/rss'
import type { FeedFetchItem, FeedFetchRequest, FeedFetchResult } from '../shared/rss'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 20_000

interface ParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

const parentPort = (process as NodeJS.Process & { parentPort: ParentPort }).parentPort

parentPort.on('message', (event) => {
  void handleMessage(event.data)
})

async function handleMessage(raw: unknown): Promise<void> {
  if (typeof raw !== 'object' || raw === null) return
  const record = raw as Record<string, unknown>
  const requestId = record['requestId']
  const folderId = record['folderId']
  const url = record['url']
  if (
    typeof requestId !== 'number' ||
    typeof folderId !== 'string' ||
    typeof url !== 'string'
  ) {
    return
  }
  const request: FeedFetchRequest = {
    requestId,
    folderId,
    url,
    etag: typeof record['etag'] === 'string' ? record['etag'] : null,
    lastModified:
      typeof record['lastModified'] === 'string' ? record['lastModified'] : null
  }

  let result: FeedFetchResult
  try {
    result = await fetchFeed(request)
  } catch (error) {
    result = {
      requestId,
      folderId,
      status: 0,
      notModified: false,
      fetchUrl: url,
      etag: null,
      lastModified: null,
      title: null,
      siteUrl: null,
      retryAfterMs: null,
      items: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
  parentPort.postMessage(result)
}

async function fetchFeed(request: FeedFetchRequest): Promise<FeedFetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const visited = new Set<string>()
  let currentUrl = request.url
  let conditionalHeaders = {
    'If-None-Match': request.etag ?? '',
    'If-Modified-Since': request.lastModified ?? ''
  }

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const parsed = new URL(currentUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Feed URL must be http(s)')
      }
      if (visited.has(currentUrl)) throw new Error('Feed redirect loop')
      visited.add(currentUrl)

      const headers: Record<string, string> = {
        accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml;q=0.9, */*;q=0.5',
        'user-agent': 'Ione/0.1 feed fetcher'
      }
      if (conditionalHeaders['If-None-Match']) {
        headers['If-None-Match'] = conditionalHeaders['If-None-Match']
      }
      if (conditionalHeaders['If-Modified-Since']) {
        headers['If-Modified-Since'] = conditionalHeaders['If-Modified-Since']
      }

      const response = await fetch(currentUrl, {
        headers,
        redirect: 'manual',
        signal: controller.signal
      })

      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new Error('Redirect without Location')
        const next = new URL(location, currentUrl)
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new Error('Redirected to a non-http(s) URL')
        }
        if (new URL(currentUrl).protocol === 'https:' && next.protocol === 'http:') {
          throw new Error('HTTPS feed redirected to HTTP')
        }
        if (visited.has(next.href)) throw new Error('Feed redirect loop')
        currentUrl = next.href
        conditionalHeaders = { 'If-None-Match': '', 'If-Modified-Since': '' }
        continue
      }

      if (response.status === 304) {
        return {
          requestId: request.requestId,
          folderId: request.folderId,
          status: 304,
          notModified: true,
          fetchUrl: currentUrl,
          etag: response.headers.get('etag') ?? request.etag,
          lastModified: response.headers.get('last-modified') ?? request.lastModified,
          title: null,
          siteUrl: null,
          retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
          items: [],
          error: null
        }
      }

      if (!response.ok) {
        throw new Error(`Feed returned HTTP ${response.status}`)
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
        throw new Error('Feed response exceeds 5 MiB')
      }
      const body = await readCapped(response)
      const parsedFeed = parseFeed(body, response.headers.get('content-type'), currentUrl)
      const items: FeedFetchItem[] = parsedFeed.items.slice(0, 500)

      return {
        requestId: request.requestId,
        folderId: request.folderId,
        status: response.status,
        notModified: false,
        fetchUrl: currentUrl,
        etag: response.headers.get('etag'),
        lastModified: validHttpDate(response.headers.get('last-modified')),
        title: parsedFeed.title,
        siteUrl: parsedFeed.siteUrl,
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
        items,
        error: null
      }
    }
    throw new Error('Too many feed redirects')
  } finally {
    clearTimeout(timeout)
  }
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error('Feed response exceeds 5 MiB')
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function validHttpDate(value: string | null): string | null {
  if (!value) return null
  return Number.isFinite(Date.parse(value)) ? value : null
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 86_400_000)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return null
  return Math.min(Math.max(0, date - Date.now()), 86_400_000)
}

// Keep the utility process alive while it waits for requests.
setInterval(() => undefined, 60_000)
