package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class ClipboardTransferTest {
    @Test fun assemblesLongUnicodeTextAndOnlyWritesAtCompletion() {
        val written = mutableListOf<String>()
        val copy = ClipboardTransfer { written.add(it) }
        val text = "Quotes \" ' \\ and lines\n\nwith accents: ação, 日本語, 🦝".repeat(5000)
        val id = copy.begin(text.length)
        for (offset in text.indices step 8192) {
            copy.append(id, offset, text.substring(offset, minOf(offset + 8192, text.length)))
            assertTrue(written.isEmpty())
        }
        copy.finish(id)
        assertEquals(listOf(text), written)
        assertThrows(IllegalStateException::class.java) { copy.finish(id) }
    }

    @Test fun rejectsIncompleteDuplicateOversizedAndOutOfOrderChunks() {
        val copy = ClipboardTransfer { fail("Invalid text reached the clipboard") }
        assertThrows(IllegalArgumentException::class.java) { copy.begin(0) }
        assertThrows(IllegalArgumentException::class.java) { copy.begin(1000001) }
        val id = copy.begin(10)
        assertThrows(IllegalStateException::class.java) { copy.append("wrong", 0, "x") }
        assertThrows(IllegalArgumentException::class.java) { copy.append(id, 1, "x") }
        assertThrows(IllegalArgumentException::class.java) { copy.append(id, 0, "x".repeat(8193)) }
        copy.append(id, 0, "hello")
        assertThrows(IllegalArgumentException::class.java) { copy.append(id, 0, "hello") }
        assertThrows(IllegalArgumentException::class.java) { copy.append(id, 5, "too long") }
        assertThrows(IllegalArgumentException::class.java) { copy.finish(id) }
        copy.cancel()
        assertThrows(IllegalStateException::class.java) { copy.finish(id) }
    }

    @Test fun cancelledAndReplacedCopiesCannotOverwriteNewerText() {
        val written = mutableListOf<String>()
        val copy = ClipboardTransfer { written.add(it) }
        val old = copy.begin(3)
        copy.append(old, 0, "old")
        val latest = copy.begin(3)
        copy.abort(old)
        assertThrows(IllegalStateException::class.java) { copy.finish(old) }
        copy.append(latest, 0, "new")
        copy.finish(latest)
        assertEquals(listOf("new"), written)
        val cancelled = copy.begin(3)
        copy.append(cancelled, 0, "bad")
        copy.abort(cancelled)
        assertThrows(IllegalStateException::class.java) { copy.finish(cancelled) }
        assertEquals(listOf("new"), written)
    }

    @Test fun systemFailurePropagatesAndAllowsRetry() {
        var attempts = 0
        val copy = ClipboardTransfer { attempts++; if (attempts == 1) error("Android refused the write") }
        var id = copy.begin(2)
        copy.append(id, 0, "ok")
        assertThrows(IllegalStateException::class.java) { copy.finish(id) }
        id = copy.begin(2)
        copy.append(id, 0, "ok")
        copy.finish(id)
        assertEquals(2, attempts)
    }
}
