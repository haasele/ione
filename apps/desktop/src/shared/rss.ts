export interface FeedFetchRequest {
  requestId: number
  folderId: string
  url: string
  etag: string | null
  lastModified: string | null
}

export interface FeedFetchItem {
  guid?: string
  url: string
  title: string
  author: string
  summary: string
  publishedAt: number | null
}

export interface FeedFetchResult {
  requestId: number
  folderId: string
  status: number
  notModified: boolean
  fetchUrl: string
  etag: string | null
  lastModified: string | null
  title: string | null
  siteUrl: string | null
  retryAfterMs: number | null
  items: FeedFetchItem[]
  error: string | null
}
