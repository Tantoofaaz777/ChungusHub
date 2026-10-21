package app.chungushub.android

import android.content.ContentResolver
import android.net.Uri
import android.provider.DocumentsContract
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** A single SAF export, with bounded, acknowledged chunks. File IO never runs on the UI thread. */
class DocumentExports(
    private val resolver: ContentResolver,
    private val ui: (() -> Unit) -> Unit,
    private val chooseDestination: (String, String) -> Unit,
    private val saved: () -> Unit
) {
    private class Transfer(val id: String, val size: Long, val reply: (Boolean, String, String?) -> Unit) {
        val cancelled = AtomicBoolean(false)
        var uri: Uri? = null
        var writer: ExportWriter? = null
    }
    private val worker = Executors.newSingleThreadExecutor()
    private var current: Transfer? = null
    private var picker: Transfer? = null

    fun begin(message: JSONObject, reply: (Boolean, String, String?) -> Unit) {
        if (current != null || picker != null) { reply(false, "An export is already in progress.", null); return }
        val size = message.optLong("size", -1)
        if (size < -1) { reply(false, "Invalid file size.", null); return }
        val transfer = Transfer(UUID.randomUUID().toString(), size, reply)
        current = transfer
        picker = transfer
        val mime = message.optString("mime").takeIf { it.matches(Regex("[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+")) } ?: "application/octet-stream"
        try { chooseDestination(safeFilename(message.optString("filename")), mime) }
        catch (_: Exception) { current = null; picker = null; reply(false, "Could not open the file picker.", null) }
    }

    fun destination(uri: Uri?) {
        val transfer = picker
        picker = null
        if (transfer == null) {
            // A result restored after process death has no source stream to resume.
            if (uri != null) worker.execute { runCatching { DocumentsContract.deleteDocument(resolver, uri) } }
            return
        }
        if (uri == null) { current = null; transfer.reply(false, "cancelled", null); return }
        transfer.uri = uri
        worker.execute {
            try {
                if (transfer.cancelled.get()) { cleanup(transfer); return@execute }
                transfer.writer = ExportWriter(resolver.openOutputStream(uri, "w") ?: error("Cannot open destination"), transfer.size)
                if (transfer.cancelled.get()) { cleanup(transfer); return@execute }
                ui { if (current === transfer) transfer.reply(true, "", transfer.id) }
            } catch (_: Exception) { fail(transfer, "Could not open the destination.") }
        }
    }

    fun handle(type: String, message: JSONObject, reply: (Boolean, String, String?) -> Unit) {
        val transfer = current
        if (transfer == null || transfer.id != message.optString("transfer")) { reply(false, "The export is no longer available.", null); return }
        if (type == "export.abort") { cancel(); reply(true, "", null); return }
        worker.execute {
            try {
                check(!transfer.cancelled.get())
                val writer = transfer.writer ?: error("Destination not ready")
                when (type) {
                    "export.chunk" -> {
                        writer.append(message.getLong("offset"), message.getString("data"))
                    }
                    "export.end" -> {
                        writer.finish(); transfer.writer = null
                    }
                    else -> error("Unknown export operation")
                }
                ui {
                    if (current === transfer && !transfer.cancelled.get()) {
                        if (type == "export.end") { current = null; saved() }
                        reply(true, "", null)
                    }
                }
            } catch (_: Exception) {
                cleanup(transfer)
                ui { if (current === transfer) { current = null; reply(false, "Could not save the file.", null) } }
            }
        }
    }

    fun cancel() {
        val transfer = current ?: return
        current = null; transfer.cancelled.set(true)
        transfer.reply(false, "cancelled", null)
        worker.execute { cleanup(transfer) }
    }

    fun close() { cancel(); worker.shutdown() }

    private fun fail(transfer: Transfer, message: String) {
        cleanup(transfer)
        ui { if (current === transfer) { current = null; transfer.reply(false, message, null) } }
    }

    private fun cleanup(transfer: Transfer) {
        runCatching { transfer.writer?.close() }; transfer.writer = null
        transfer.uri?.let { uri -> runCatching { DocumentsContract.deleteDocument(resolver, uri) } }
    }
}
