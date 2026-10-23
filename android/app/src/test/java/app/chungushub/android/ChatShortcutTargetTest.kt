package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class ChatShortcutTargetTest {
    @Test fun eachChatAndServerHaveIndependentStableIds() {
        val first = ChatShortcutTarget("https://example.com", "chat-1", "My story")
        assertEquals(first.shortcutId, first.copy(title = "Renamed story").shortcutId)
        assertNotEquals(first.shortcutId, first.copy(chatId = "chat-2").shortcutId)
        assertNotEquals(first.shortcutId, first.copy(origin = "https://another.example.com").shortcutId)
        assertTrue(first.shortcutId.matches(Regex("chat-[a-f0-9]{64}")))
        assertFalse(first.shortcutId.contains("chat-1"))
    }

    @Test fun preservesUnicodeNamesWithoutPuttingThemInLauncherIntentIds() {
        val target = ChatShortcutTarget("https://example.com", "id-密碼", "Minha história 🦝")
        assertEquals("Minha história 🦝", target.title)
        assertEquals(69, target.shortcutId.length)
    }

    @Test fun rejectsUnsafeOriginsAndUnboundedOrEmptyMetadata() {
        for (origin in listOf("http://example.com", "https://user:pw@example.com", "https://example.com/path", "https://example.com:443")) {
            assertThrows(Exception::class.java) { ChatShortcutTarget(origin, "chat", "Story") }
        }
        for (id in listOf("", " ", "bad\nID", "a".repeat(201))) {
            assertThrows(Exception::class.java) { ChatShortcutTarget("https://example.com", id, "Story") }
        }
        assertThrows(Exception::class.java) { ChatShortcutTarget("https://example.com", "id", "a".repeat(121)) }
    }
}
