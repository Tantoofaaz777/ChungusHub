package app.chungushub.android

import java.util.UUID

/** One bounded text transfer. Chunk offsets count UTF-16 code units, as in JavaScript. */
class ClipboardTransfer(private val write: (String) -> Unit) {
    private var id: String? = null
    private var expected = 0
    private var text = StringBuilder()

    fun begin(size: Int): String {
        require(size in 1..1000000) { "The text is empty or too large to copy." }
        // The previous acknowledgement may have been lost when WebView was suspended.
        cancel()
        expected = size
        text = StringBuilder()
        return UUID.randomUUID().toString().also { id = it }
    }

    fun append(transfer: String, offset: Int, chunk: String) {
        check(id != null && transfer == id) { "The copy is no longer available." }
        require(offset == text.length && chunk.length in 1..8192 && text.length + chunk.length <= expected) {
            "Invalid clipboard chunk."
        }
        text.append(chunk)
    }

    fun finish(transfer: String) {
        check(id != null && transfer == id) { "The copy is no longer available." }
        require(text.length == expected) { "The clipboard text is incomplete." }
        val result = text.toString()
        cancel()
        write(result) // Only a verified OS write may acknowledge the final request.
    }

    fun abort(transfer: String) { if (id == transfer) cancel() }
    fun cancel() { id = null; expected = 0; text = StringBuilder() }
}
