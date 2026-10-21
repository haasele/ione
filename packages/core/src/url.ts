/**
 * Address classification for the omnibox. Pure string handling with no
 * Electron dependencies.
 */

export interface NormalizedAddress {
  url: string
  kind: 'url' | 'search'
}

const DEFAULT_SEARCH_BASE = 'https://duckduckgo.com/?q='
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):/i
const LOCALHOST = /^localhost(?::\d{1,5})?(?:[/?#].*)?$/i
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#].*)?$/
const HOST_WITH_PORT =
  /^(?:localhost|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*):\d{1,5}(?:[/?#].*)?$/i

function parseWebUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.hostname.length === 0) return null
    return url.href
  } catch {
    return null
  }
}

function parseAboutUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate)
    return url.protocol === 'about:' && url.pathname === 'blank' ? 'about:blank' : null
  } catch {
    return null
  }
}

function parseExtensionUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'chrome-extension:' || url.hostname.length === 0) return null
    return url.href
  } catch {
    return null
  }
}

function searchFor(input: string, searchBase: string): NormalizedAddress {
  return { url: `${searchBase}${encodeURIComponent(input)}`, kind: 'search' }
}

function looksLikeBareDomain(input: string): boolean {
  if (input.includes('@')) return false
  if (!input.includes('.')) return false
  if (/\s/.test(input)) return false
  const host = input.split(/[/?#]/, 1)[0] ?? ''
  return host.includes('.') && !host.startsWith('.') && !host.endsWith('.')
}

/**
 * Classifies raw omnibox text.
 *
 * - explicit http/https/about URLs are returned canonicalized
 * - localhost, host:port and IPv4 literals default to http
 * - bare domains default to https
 * - everything else (spaces, javascript:, data:, file:, ...) becomes a search
 *
 * Returns null for empty input and for unparseable explicit web URLs.
 */
export function normalizeAddress(
  input: string,
  searchBase: string = DEFAULT_SEARCH_BASE
): NormalizedAddress | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const schemeMatch = EXPLICIT_SCHEME.exec(trimmed)
  const scheme = schemeMatch?.[1]?.toLowerCase() ?? null

  if (scheme === 'http' || scheme === 'https') {
    const url = parseWebUrl(trimmed)
    return url === null ? null : { url, kind: 'url' }
  }
  if (scheme === 'about') {
    const url = parseAboutUrl(trimmed)
    return url === null ? searchFor(trimmed, searchBase) : { url, kind: 'url' }
  }
  if (scheme === 'chrome-extension') {
    const url = parseExtensionUrl(trimmed)
    return url === null ? searchFor(trimmed, searchBase) : { url, kind: 'url' }
  }

  if (LOCALHOST.test(trimmed) || IPV4.test(trimmed) || HOST_WITH_PORT.test(trimmed)) {
    const url = parseWebUrl(`http://${trimmed}`)
    if (url !== null) return { url, kind: 'url' }
  }

  // Any other explicit scheme is a search, never a navigation.
  if (scheme !== null) return searchFor(trimmed, searchBase)

  if (looksLikeBareDomain(trimmed)) {
    const url = parseWebUrl(`https://${trimmed}`)
    if (url !== null) return { url, kind: 'url' }
  }

  return searchFor(trimmed, searchBase)
}

/** True only for URLs a renderer may hand to a trusted navigation handler. */
export function isSafeNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'about:') return parsed.pathname === 'blank'
    if (parsed.protocol === 'chrome-extension:') return parsed.hostname.length > 0
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
