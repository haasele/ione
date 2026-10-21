import { describe, expect, it } from 'vitest'
import { parseFeed } from './feed'

const RSS2 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example News</title>
    <link>https://example.com/</link>
    <item>
      <title>First &amp; Best</title>
      <link>/posts/first</link>
      <guid>post-1</guid>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
      <dc:creator>Ada</dc:creator>
      <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second</title>
      <link>https://example.com/posts/second</link>
      <content:encoded><![CDATA[<p>Long form</p>]]></content:encoded>
      <pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>No link</title>
      <guid>post-3</guid>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <link href="https://atom.example/" rel="alternate"/>
  <entry>
    <id>tag:atom.example,2026:1</id>
    <title>Atom One</title>
    <link rel="alternate" href="https://atom.example/one"/>
    <summary>Summary one</summary>
    <published>2026-10-18T09:00:00Z</published>
    <author><name>Grace</name></author>
  </entry>
</feed>`

const RSS1 = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><title>RDF Feed</title><link>https://rdf.example/</link></channel>
  <item rdf:about="https://rdf.example/a">
    <title>RDF item</title>
    <link>https://rdf.example/a</link>
    <dc:date>2026-10-17T08:00:00Z</dc:date>
  </item>
</rdf:RDF>`

describe('parseFeed', () => {
  it('normalizes RSS 2.0 and resolves relative URLs', () => {
    const feed = parseFeed(RSS2, 'application/rss+xml', 'https://example.com/feed.xml')
    expect(feed.title).toBe('Example News')
    expect(feed.siteUrl).toBe('https://example.com/')
    expect(feed.items).toHaveLength(2)
    expect(feed.items[0]).toMatchObject({
      title: 'First & Best',
      url: 'https://example.com/posts/first',
      guid: 'post-1',
      author: 'Ada',
      summary: 'Hello world',
      publishedAt: Date.parse('Tue, 20 Oct 2026 10:00:00 GMT')
    })
  })

  it('normalizes Atom and RSS 1.0', () => {
    const atom = parseFeed(ATOM, 'application/atom+xml', 'https://atom.example/feed.xml')
    expect(atom.items[0]).toMatchObject({
      title: 'Atom One',
      url: 'https://atom.example/one',
      author: 'Grace',
      publishedAt: Date.parse('2026-10-18T09:00:00Z')
    })
    const rss1 = parseFeed(RSS1, 'application/rdf+xml', 'https://rdf.example/feed.xml')
    expect(rss1.items[0]).toMatchObject({
      title: 'RDF item',
      url: 'https://rdf.example/a',
      guid: 'https://rdf.example/a'
    })
  })

  it('normalizes JSON Feed', () => {
    const feed = parseFeed(
      JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1',
        title: 'JSON Example',
        home_page_url: 'https://json.example/',
        items: [
          {
            id: '1',
            url: 'https://json.example/post',
            title: 'JSON item',
            content_text: 'Text body',
            authors: [{ name: 'Linus' }],
            date_published: '2026-10-16T07:00:00Z'
          }
        ]
      }),
      'application/feed+json',
      'https://json.example/feed.json'
    )
    expect(feed.items[0]).toMatchObject({
      title: 'JSON item',
      author: 'Linus',
      summary: 'Text body',
      guid: '1'
    })
  })

  it('rejects unsupported or malformed documents', () => {
    expect(() => parseFeed('<html><body>nope</body></html>', 'text/html', 'https://x.example/')).toThrow(
      /Unsupported feed format/
    )
    expect(() => parseFeed('{broken', 'application/json', 'https://x.example/')).toThrow(
      /Invalid JSON feed/
    )
  })

  it('does not expand XML entities', () => {
    const feed = parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title><item><title>&xxe;</title><link>https://x.example/a</link></item></channel></rss>`,
      'application/rss+xml',
      'https://x.example/feed.xml'
    )
    expect(feed.items[0]?.title).not.toMatch(/secret/)
  })
})
