import { describe, expect, it } from 'vitest'
import { isSafeNavigationUrl, normalizeAddress } from './url'

const SEARCH_BASE = 'https://duckduckgo.com/?q='

describe('normalizeAddress', () => {
  it.each([
    ['https://example.com', 'https://example.com/', 'url'],
    ['https://example.com/path?q=1#frag', 'https://example.com/path?q=1#frag', 'url'],
    ['  https://example.com  ', 'https://example.com/', 'url'],
    ['http://example.com/a', 'http://example.com/a', 'url'],
    ['example.com', 'https://example.com/', 'url'],
    ['example.com/path?x=1', 'https://example.com/path?x=1', 'url'],
    ['localhost:5173', 'http://localhost:5173/', 'url'],
    ['localhost', 'http://localhost/', 'url'],
    ['127.0.0.1:3000', 'http://127.0.0.1:3000/', 'url'],
    ['127.0.0.1', 'http://127.0.0.1/', 'url'],
    ['about:blank', 'about:blank', 'url'],
    ['about:config', `${SEARCH_BASE}about%3Aconfig`, 'search'],
    ['about:srcdoc', `${SEARCH_BASE}about%3Asrcdoc`, 'search'],
    ['hello world', `${SEARCH_BASE}hello%20world`, 'search'],
    ['javascript:alert(1)', `${SEARCH_BASE}javascript%3Aalert(1)`, 'search'],
    ['data:text/html,hi', `${SEARCH_BASE}data%3Atext%2Fhtml%2Chi`, 'search'],
    ['file:///etc/passwd', `${SEARCH_BASE}file%3A%2F%2F%2Fetc%2Fpasswd`, 'search'],
    ['mailto:someone@example.com', `${SEARCH_BASE}mailto%3Asomeone%40example.com`, 'search'],
    ['hello', `${SEARCH_BASE}hello`, 'search'],
    ['two words.example', `${SEARCH_BASE}two%20words.example`, 'search']
  ])('classifies %j', (input, url, kind) => {
    expect(normalizeAddress(input)).toEqual({ url, kind })
  })

  it.each(['', '   ', '\n\t'])('returns null for empty input %j', (input) => {
    expect(normalizeAddress(input)).toBeNull()
  })

  it('returns null for an unparseable explicit web URL', () => {
    expect(normalizeAddress('http://')).toBeNull()
    expect(normalizeAddress('https://')).toBeNull()
  })

  it('uses a custom search base', () => {
    expect(normalizeAddress('hello world', 'https://search.example/?q=')).toEqual({
      url: 'https://search.example/?q=hello%20world',
      kind: 'search'
    })
  })

  it('never marks unknown schemes as navigable urls', () => {
    expect(normalizeAddress('ftp://example.com')?.kind).toBe('search')
    expect(normalizeAddress('chrome://settings')?.kind).toBe('search')
  })
})

describe('isSafeNavigationUrl', () => {
  it.each([
    'https://example.com',
    'http://localhost:5173/',
    'about:blank'
  ])('accepts %j', (url) => {
    expect(isSafeNavigationUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'chrome://settings',
    'ftp://example.com',
    'about:config',
    'about:srcdoc',
    '/relative/path',
    'not a url',
    ''
  ])('rejects %j', (url) => {
    expect(isSafeNavigationUrl(url)).toBe(false)
  })
})
