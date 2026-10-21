import { XMLParser } from 'fast-xml-parser'

export interface ParsedFeedItem {
  guid?: string
  url: string
  title: string
  author: string
  summary: string
  publishedAt: number | null
}

export interface ParsedFeed {
  title: string
  siteUrl: string | null
  items: ParsedFeedItem[]
}

const MAX_ITEMS = 500
const MAX_SUMMARY = 4000
const MAX_TITLE = 512

/**
 * Parses RSS 2.0, RSS 1.0/RDF, Atom, or JSON Feed into a small normalized
 * shape. Entity expansion is disabled; the caller handles size/time limits.
 */
export function parseFeed(
  body: string,
  contentType: string | null,
  baseUrl: string
): ParsedFeed {
  const looksJson =
    contentType?.toLowerCase().includes('json') || body.trimStart().startsWith('{')

  if (looksJson) return parseJsonFeed(body, baseUrl)

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    processEntities: false,
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    maxNestedTags: 128
  })

  let document: unknown
  try {
    document = parser.parse(body)
  } catch (error) {
    throw new Error(`Invalid XML feed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const root = asRecord(document)
  if (isRecord(root['rss'])) return parseRss2(root['rss'], baseUrl)
  if (isRecord(root['rdf:RDF'])) return parseRss1(root['rdf:RDF'], baseUrl)
  if (isRecord(root['RDF'])) return parseRss1(root['RDF'], baseUrl)
  if (isRecord(root['feed'])) return parseAtom(root['feed'], baseUrl)
  throw new Error('Unsupported feed format')
}

function parseRss2(rss: Record<string, unknown>, baseUrl: string): ParsedFeed {
  const channel = asRecord(rss['channel'])
  const feedTitle = text(channel['title']).slice(0, MAX_TITLE) || 'RSS feed'
  const siteUrl = absoluteUrl(text(channel['link']), baseUrl)
  const items = asArray(channel['item'])
    .map((raw) => {
      const item = asRecord(raw)
      const link = absoluteUrl(text(item['link']), baseUrl)
      const guid = text(item['guid']) || undefined
      const url = link ?? directUrl(guid ?? '')
      if (!url) return null
      const parsed: ParsedFeedItem = {
        url,
        title: text(item['title']).slice(0, MAX_TITLE) || 'Untitled',
        author: text(item['dc:creator']) || text(item['author']),
        summary: summaryText(
          text(item['content:encoded']) || text(item['description'])
        ),
        publishedAt: dateValue(text(item['pubDate']) || text(item['dc:date']))
      }
      if (guid) parsed.guid = guid
      return parsed
    })
    .filter((item): item is ParsedFeedItem => item !== null)

  return { title: feedTitle, siteUrl, items: finishItems(items) }
}

function parseRss1(rdf: Record<string, unknown>, baseUrl: string): ParsedFeed {
  const channel = asRecord(rdf['channel'])
  const feedTitle = text(channel['title']).slice(0, MAX_TITLE) || 'RSS feed'
  const siteUrl = absoluteUrl(text(channel['link']), baseUrl)
  const items = asArray(rdf['item'])
    .map((raw) => {
      const item = asRecord(raw)
      const link = absoluteUrl(text(item['link']), baseUrl)
      const guid = text(item['@_rdf:about']) || text(item['dc:identifier']) || undefined
      const url = link ?? directUrl(guid ?? '')
      if (!url) return null
      const parsed: ParsedFeedItem = {
        url,
        title: text(item['title']).slice(0, MAX_TITLE) || 'Untitled',
        author: text(item['dc:creator']) || text(item['author']),
        summary: summaryText(text(item['description']) || text(item['content:encoded'])),
        publishedAt: dateValue(text(item['dc:date']) || text(item['pubDate']))
      }
      if (guid) parsed.guid = guid
      return parsed
    })
    .filter((item): item is ParsedFeedItem => item !== null)

  return { title: feedTitle, siteUrl, items: finishItems(items) }
}

function parseAtom(feed: Record<string, unknown>, baseUrl: string): ParsedFeed {
  const feedTitle = text(feed['title']).slice(0, MAX_TITLE) || 'Atom feed'
  const siteUrl = atomLink(feed['link'], baseUrl)
  const items = asArray(feed['entry'])
    .map((raw) => {
      const entry = asRecord(raw)
      const link = atomLink(entry['link'], baseUrl)
      const guid = text(entry['id']) || undefined
      const url = link ?? directUrl(guid ?? '')
      if (!url) return null
      const author = asRecord(entry['author'])
      const parsed: ParsedFeedItem = {
        url,
        title: text(entry['title']).slice(0, MAX_TITLE) || 'Untitled',
        author: text(author['name']),
        summary: summaryText(text(entry['summary']) || text(entry['content'])),
        publishedAt: dateValue(text(entry['published']) || text(entry['updated']))
      }
      if (guid) parsed.guid = guid
      return parsed
    })
    .filter((item): item is ParsedFeedItem => item !== null)

  return { title: feedTitle, siteUrl, items: finishItems(items) }
}

function parseJsonFeed(body: string, baseUrl: string): ParsedFeed {
  let document: unknown
  try {
    document = JSON.parse(body)
  } catch (error) {
    throw new Error(`Invalid JSON feed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const feed = asRecord(document)
  const feedTitle = text(feed['title']).slice(0, MAX_TITLE) || 'JSON feed'
  const siteUrl = absoluteUrl(text(feed['home_page_url']), baseUrl)
  const items = asArray(feed['items'])
    .map((raw) => {
      const item = asRecord(raw)
      const url = absoluteUrl(text(item['url']), baseUrl) ?? directUrl(text(item['id']))
      if (!url) return null
      const id = text(item['id'])
      const authors = asArray(item['authors'])
      const author =
        text(asRecord(authors[0])['name']) || text(item['author']) || ''
      const parsed: ParsedFeedItem = {
        url,
        title: text(item['title']).slice(0, MAX_TITLE) || 'Untitled',
        author,
        summary: summaryText(text(item['summary']) || text(item['content_text']) || text(item['content_html'])),
        publishedAt: dateValue(text(item['date_published']) || text(item['date_modified']))
      }
      if (id) parsed.guid = id
      return parsed
    })
    .filter((item): item is ParsedFeedItem => item !== null)

  return { title: feedTitle, siteUrl, items: finishItems(items) }
}

function finishItems(items: ParsedFeedItem[]): ParsedFeedItem[] {
  const seen = new Set<string>()
  const unique: ParsedFeedItem[] = []
  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    unique.push(item)
    if (unique.length >= MAX_ITEMS) break
  }
  return unique.sort((left, right) => {
    const leftDate = left.publishedAt ?? -Infinity
    const rightDate = right.publishedAt ?? -Infinity
    if (leftDate !== rightDate) return rightDate - leftDate
    return left.title.localeCompare(right.title)
  })
}

function atomLink(value: unknown, baseUrl: string): string | null {
  for (const raw of asArray(value)) {
    if (typeof raw === 'string') {
      const url = absoluteUrl(raw, baseUrl)
      if (url) return url
      continue
    }
    const link = asRecord(raw)
    const rel = text(link['@_rel'])
    if (rel && rel !== 'alternate') continue
    const href = absoluteUrl(text(link['@_href']), baseUrl)
    if (href) return href
  }
  return null
}

function directUrl(candidate: string): string | null {
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

function absoluteUrl(candidate: string, baseUrl: string): string | null {
  if (!candidate) return null
  try {
    const url = new URL(candidate, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

function dateValue(value: string): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function summaryText(value: string): string {
  const plain = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return plain.slice(0, MAX_SUMMARY)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      const code = Number.parseInt(name.slice(2), 16)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (name.startsWith('#')) {
      const code = Number.parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[name] ?? match
  })
}

function text(value: unknown): string {
  if (typeof value === 'string') return decodeEntities(value.trim())
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return text(value[0])
  if (isRecord(value)) {
    const inner = value['#text']
    if (inner !== undefined) return text(inner)
  }
  return ''
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
