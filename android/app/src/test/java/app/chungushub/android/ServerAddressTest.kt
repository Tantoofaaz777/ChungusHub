package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun canonicalHttpsAddressAndExactOrigin() {
        val server = ServerAddress.parse("  EXAMPLE.com:443/chungus/  ")
        assertEquals("https://example.com/chungus/", server.url)
        assertEquals("https://example.com", server.origin)
        assertTrue(server.trusts("https://example.com/api/files?token=abc"))
        assertTrue(server.trusts("https://EXAMPLE.COM:443/chat"))
        for (url in listOf("https://example.com.evil.test", "https://evil.test/example.com", "http://example.com", "https://example.com:444", "https://user@example.com", "file:///tmp/file", "data:text/html,hello", "javascript:alert(1)")) {
            assertFalse(url, server.trusts(url))
        }
    }
    @Test fun supportsPortsAndIpv6() {
        val server = ServerAddress.parse("https://[::1]:4242/")
        assertEquals("https://[::1]:4242", server.origin)
        assertTrue(server.trusts("https://[::1]:4242/api"))
        assertFalse(server.trusts("https://[::1]/api"))
    }
    @Test fun rejectsCredentialsParametersAndUnsupportedSchemes() {
        for (url in listOf("", "http://example.com", "ftp://example.com", "https://user:password@example.com", "https://example.com?secret=value", "https://example.com#fragment", "https://example.com:0", "https://example.com:99999", "https://bad host.test")) {
            assertThrows(url, Exception::class.java) { ServerAddress.parse(url) }
        }
    }
    @Test fun exportNamesCannotContainPathsOrControlCharacters() {
        assertEquals("card.png", safeFilename("../../card.png"))
        assertEquals("card.json", safeFilename("C:\\private\\card.json"))
        assertEquals("bad_name_.zip", safeFilename("bad\nname?.zip"))
        assertEquals("chungus-export", safeFilename(""))
        assertEquals(180, safeFilename("a".repeat(250)).length)
    }
}
