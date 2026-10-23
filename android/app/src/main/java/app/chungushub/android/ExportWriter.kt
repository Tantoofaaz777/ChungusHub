package app.chungushub.android

import java.io.OutputStream
import java.util.Base64

/** Pure streaming protocol: rejects skipped/duplicate chunks and incomplete files. */
class ExportWriter(private val output: OutputStream, private val size: Long, private val maxBytes: Long = Long.MAX_VALUE) : AutoCloseable {
    private var received = 0L
    fun append(offset: Long, encoded: String) {
        require(encoded.length <= 65536 && offset == received)
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size <= 49152)
        require(size < 0 || received + bytes.size <= size)
        require(received + bytes.size <= maxBytes)
        output.write(bytes)
        received += bytes.size
    }
    fun finish() { require(size < 0 || received == size); close() }
    override fun close() { output.close() }
}
