package app.chungushub.android

import java.io.ByteArrayOutputStream
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class ExportWriterTest {
    private fun encoded(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)
    @Test fun writesBinaryChunksExactlyIncludingEmptyFilesAndUnknownSizes() {
        val bytes = ByteArray(200000) { (it % 256).toByte() }
        for (size in listOf(bytes.size.toLong(), -1L)) {
            val output = ByteArrayOutputStream()
            val writer = ExportWriter(output, size)
            for (offset in bytes.indices step 49152) writer.append(offset.toLong(), encoded(bytes.copyOfRange(offset, minOf(offset + 49152, bytes.size))))
            writer.finish()
            assertArrayEquals(bytes, output.toByteArray())
        }
        ExportWriter(ByteArrayOutputStream(), 0).finish()
    }
    @Test fun rejectsOutOfOrderDuplicateOversizedAndIncompleteChunks() {
        val writer = ExportWriter(ByteArrayOutputStream(), 4)
        assertThrows(IllegalArgumentException::class.java) { writer.append(1, encoded(byteArrayOf(1))) }
        writer.append(0, encoded(byteArrayOf(1, 2)))
        assertThrows(IllegalArgumentException::class.java) { writer.append(0, encoded(byteArrayOf(1, 2))) }
        assertThrows(IllegalArgumentException::class.java) { writer.append(2, encoded(byteArrayOf(1, 2, 3))) }
        assertThrows(IllegalArgumentException::class.java) { writer.finish() }
        assertThrows(IllegalArgumentException::class.java) { writer.append(2, "not base64") }
        assertThrows(IllegalArgumentException::class.java) { ExportWriter(ByteArrayOutputStream(), -1).append(0, encoded(ByteArray(49153))) }
        writer.close()
    }
}
