package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class ServerLoginTest {
    private val cookie = "chungus_session=" + "a".repeat(64) + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000"

    @Test fun requiresAnActualServerSessionAndPreservesHttpOnly() {
        assertEquals(cookie, ServerLogin.sessionCookie(200, listOf("other=1", cookie)))
        for (cookies in listOf(emptyList(), listOf("chungus_session=bad; Path=/"), listOf("other=" + "a".repeat(64)))) {
            assertThrows(LoginRejected::class.java) { ServerLogin.sessionCookie(200, cookies) }
        }
    }

    @Test fun redirectsRejectionsAndRateLimitsDoNotUnlock() {
        for (status in listOf(301, 302, 307, 401, 403, 429, 500)) {
            val error = assertThrows(LoginRejected::class.java) { ServerLogin.sessionCookie(status, listOf(cookie)) }
            assertEquals(status, error.status)
        }
    }
}
