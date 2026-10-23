package app.chungushub.android

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.nio.file.Files
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class SharedInboxTest {
    private val root = Files.createTempDirectory("chungus-shared-inbox-").toFile()
    private val inbox = SharedInbox(root)
    private fun id(index: Int = 0) = "${UUID.randomUUID()}_$index"
    @After fun cleanup() { root.deleteRecursively() }

    @Test fun preservesBinaryDataAndUnicodeNamesAcrossReopening() {
        val bytes = ByteArray(160000) { (it % 256).toByte() }
        val id = id()
        val item = inbox.put(id, "🦝 ação 日本語.png", "image/png") { ByteArrayInputStream(bytes) }
        assertEquals("🦝 ação 日本語.png", item.name)
        assertEquals(bytes.size.toLong(), item.size)
        val reopened = SharedInbox(root)
        assertEquals(listOf(item), reopened.list())
        val restored = ArrayList<Byte>()
        for (offset in bytes.indices step 49152) restored.addAll(reopened.read(id, offset.toLong()).toList())
        assertArrayEquals(bytes, restored.toByteArray())
        reopened.remove(id)
        assertTrue(inbox.list().isEmpty())
        assertTrue(root.listFiles()!!.isEmpty())
    }

    @Test fun recreationDoesNotDuplicateAnAlreadyCapturedIntent() {
        val id = id()
        val first = inbox.put(id, "card.json", "application/json") { ByteArrayInputStream("original".toByteArray()) }
        val again = SharedInbox(root).put(id, "changed.json", "application/json") { fail("The provider was read twice"); ByteArrayInputStream(byteArrayOf()) }
        assertEquals(first, again)
        assertEquals(1, inbox.list().size)
    }

    @Test fun failedOrOversizedReadsLeaveNoImportableOrPartialFiles() {
        val small = SharedInbox(root, 4)
        assertThrows(IllegalArgumentException::class.java) { small.put(id(), "large.png", "image/png") { ByteArrayInputStream(ByteArray(5)) } }
        assertThrows(IllegalArgumentException::class.java) { small.put(id(), "empty.png", "image/png") { ByteArrayInputStream(byteArrayOf()) } }
        var closed = false
        assertThrows(IllegalStateException::class.java) {
            small.put(id(), "failed.png", "image/png") { object : InputStream() {
                override fun read(): Int = error("Provider disappeared")
                override fun close() { closed = true }
            } }
        }
        assertTrue(closed)
        assertTrue(root.listFiles()!!.isEmpty())
    }

    @Test fun rejectsTraversalBadOffsetsAndMissingFilesAndBoundsTheQueue() {
        val id = id()
        inbox.put(id, "card.png", "image/png") { ByteArrayInputStream(byteArrayOf(1, 2)) }
        assertThrows(IllegalArgumentException::class.java) { inbox.read(id, -1) }
        assertThrows(IllegalArgumentException::class.java) { inbox.read(id, 2) }
        assertThrows(IllegalStateException::class.java) { inbox.read(id(), 0) }
        assertThrows(IllegalArgumentException::class.java) { inbox.remove("../../other") }
        for (i in 1..19) inbox.put(id(i), "card.png", "image/png") { ByteArrayInputStream(byteArrayOf(1)) }
        assertThrows(IllegalArgumentException::class.java) { inbox.put(id(), "extra.png", "image/png") { ByteArrayInputStream(byteArrayOf(1)) } }
        assertEquals(20, inbox.list().size)
    }

    @Test fun boundsTheTotalQueueWithoutRemovingEarlierFiles() {
        val small = SharedInbox(root, 4, 6)
        val first = small.put(id(), "one.json", "application/json") { ByteArrayInputStream(byteArrayOf(1, 2, 3)) }
        assertThrows(IllegalArgumentException::class.java) {
            small.put(id(), "two.json", "application/json") { ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)) }
        }
        assertEquals(listOf(first), small.list())
        assertArrayEquals(byteArrayOf(1, 2, 3), small.read(first.id, 0))
    }
}
