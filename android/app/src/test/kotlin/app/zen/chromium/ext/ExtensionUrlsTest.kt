package app.zen.chromium.ext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The two spellings of an extension page's URL; the Kotlin twin of `extensionUrls.test.ts`. */
class ExtensionUrlsTest {
    private val id = "dhdgffkkebhmkfjojejmpbldmpobfkfo"
    private val served = "https://$id.ext.ione.invalid"

    @Test
    fun mapsChromeExtensionToTheServedOriginAndBack() {
        assertEquals("$served/options.html?tab=1#x", ExtensionUrls.toServed("chrome-extension://$id/options.html?tab=1#x"))
        assertEquals("chrome-extension://$id/options.html?tab=1#x", ExtensionUrls.present("$served/options.html?tab=1#x"))
        assertEquals("$served/", ExtensionUrls.toServed("chrome-extension://$id"))
        assertEquals("$served/?q", ExtensionUrls.toServed("chrome-extension://$id?q"))
        assertEquals("chrome-extension://$id/", ExtensionUrls.present(served))
        assertEquals("chrome-extension://$id/#h", ExtensionUrls.present("$served#h"))
        assertEquals("$served/a/b.js", ExtensionUrls.toServed(ExtensionUrls.present("$served/a/b.js")))
        assertEquals("chrome-extension://$id/p", ExtensionUrls.present("HTTPS://${id.uppercase()}.EXT.IONE.INVALID/p"))
        assertTrue(ExtensionUrls.isExtensionUrl("chrome-extension://$id"))
        assertTrue(ExtensionUrls.isExtensionUrl("$served/x"))
    }

    @Test
    fun leavesEveryOtherUrlAlone() {
        for (other in listOf(
            "https://page.example/x",
            "https://$id.ext.ione.invalid.evil.example/",
            "https://evil.example/$served/",
            "chrome-extension://not-an-id/x",
            "chrome-extension://${id.dropLast(1)}/x",
            "chrome-extension://${id}q/x",
            "http://$id.ext.ione.invalid/x",
            "about:blank",
            ""
        )) {
            assertEquals(other, ExtensionUrls.toServed(other))
            assertEquals(other, ExtensionUrls.present(other))
            assertFalse(other, ExtensionUrls.isExtensionUrl(other))
        }
    }

    @Test
    fun readsThePageOriginAliasPathAndNoOther() {
        // `/.ione-ext/<id>/<path>` under a page's own origin, the path without its leading
        // slash as `Served.webAccessible` matches it; the id in lower case (`pageAliasUrl`'s twin).
        assertEquals(id to "assets/widget.js", ExtensionUrls.pageAlias("/.ione-ext/$id/assets/widget.js"))
        assertEquals(id to "a/b/c.css", ExtensionUrls.pageAlias("/.IONE-EXT/${id.uppercase()}/a/b/c.css"))
        assertEquals(id to "", ExtensionUrls.pageAlias("/.ione-ext/$id/"))
        assertEquals(id to "", ExtensionUrls.pageAlias("/.ione-ext/$id"))
        assertEquals(".ione-ext", ExtensionUrls.PAGE_ALIAS_SEGMENT)
        for (other in listOf(
            "/",
            "/assets/widget.js",
            "/ione-ext/$id/a.js",
            "/.ione-ext/not-an-id/a.js",
            "/.ione-ext/${id.dropLast(1)}/a.js",
            "/.ione-ext/${id}q/a.js",
            "/x/.ione-ext/$id/a.js",
            ""
        )) {
            assertEquals(other, null, ExtensionUrls.pageAlias(other))
        }
    }

    @Test
    fun namesTheExtensionsOwnFileAtItsOriginOrItsPageOriginAlias() {
        // The spelling a content script's own `import()` asks the chunk exec with (`chunkScript`):
        // the served origin, or the page-origin alias under any page once the page's policy refused
        // the origin; the path without its leading slash, the query and fragment dropped.
        assertEquals("connectors/youtube.js", ExtensionUrls.ownFile("$served/connectors/youtube.js", id))
        assertEquals("connectors/youtube.js", ExtensionUrls.ownFile("$served/connectors/youtube.js?ione-plain=1#x", id))
        assertEquals("connectors/youtube.js", ExtensionUrls.ownFile("https://m.youtube.com/.ione-ext/$id/connectors/youtube.js", id))
        assertEquals("a/b.js", ExtensionUrls.ownFile("http://10.0.2.2:8765/.ione-ext/${id.uppercase()}/a/b.js?v=2", id))
        assertEquals("a/b.js", ExtensionUrls.ownFile("HTTPS://${id.uppercase()}.EXT.IONE.INVALID/a/b.js", id))
        assertEquals("", ExtensionUrls.ownFile("$served/", id))
        assertEquals("", ExtensionUrls.ownFile("https://page.example/.ione-ext/$id", id))
        // Another extension's file, either spelling; a page's own file; the alias segment off the root.
        val other = "dhdgffkkebhmkfjojejmpbldmpobfkfp"
        for (foreign in listOf(
            "https://$other.ext.ione.invalid/a.js",
            "https://m.youtube.com/.ione-ext/$other/a.js",
            "https://m.youtube.com/connectors/youtube.js",
            "https://m.youtube.com/x/.ione-ext/$id/a.js",
            "chrome-extension://$id/a.js",
            "ione-ext://content-scripts/boot.js",
            ""
        )) {
            assertEquals(foreign, null, ExtensionUrls.ownFile(foreign, id))
        }
    }
}
