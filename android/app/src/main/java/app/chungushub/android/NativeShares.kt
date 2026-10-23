package app.chungushub.android

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors

class ShareFileProvider : FileProvider()

/** File IO is serialized off the UI thread; the Sharesheet itself opens on the activity. */
class NativeShares(
    private val context: Context,
    private val ui: (() -> Unit) -> Unit,
    private val launch: (Intent) -> Unit,
    private val incoming: () -> Unit,
    private val failure: (String) -> Unit
) {
    private val worker = Executors.newSingleThreadExecutor()
    private val incomingWorker = Executors.newSingleThreadExecutor()
    private val outgoing = File(context.cacheDir, "shared-outgoing")
    private val inbox = SharedInbox(File(context.cacheDir, "shared-incoming"))
    @Volatile private var generation = 0
    private data class Transfer(val id: String, val file: File, val mime: String, val writer: ExportWriter, val generation: Int)
    private var current: Transfer? = null

    fun text(text: String, reply: (JSONObject) -> Unit) {
        val epoch = generation
        // Large text exceeds Android's Binder transaction limit; send those bytes as a text file.
        if (text.length > 64000) {
            worker.execute {
                runCatching {
                    val file = destination("message.txt")
                    file.writeText(text, Charsets.UTF_8)
                    offer(file, "text/plain", reply, epoch)
                }.onFailure { respond(reply, JSONObject().put("error", "Could not share the text. Please try again.")) }
            }
        } else {
            try {
                launch(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text)
                }, "Share with"))
                reply(JSONObject())
            } catch (_: Exception) { reply(JSONObject().put("error", "Could not open Android sharing.")) }
        }
    }

    private fun destination(name: String): File {
        outgoing.mkdirs()
        // Keep finished files long enough for receiving apps to consume their granted URI.
        outgoing.listFiles().orEmpty().filter { it.isDirectory && it.lastModified() < System.currentTimeMillis() - 86400000 }
            .forEach { it.deleteRecursively() }
        return File(File(outgoing, UUID.randomUUID().toString()).apply { mkdirs() }, safeFilename(name))
    }

    private fun offer(file: File, mime: String, reply: ((JSONObject) -> Unit)? = null, epoch: Int = generation) {
        ui {
            try {
                check(epoch == generation) { "The page changed before sharing finished." }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.sharing", file)
                launch(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = mime
                    putExtra(Intent.EXTRA_STREAM, uri)
                    clipData = ClipData.newRawUri(file.name, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }, "Share with"))
                reply?.invoke(JSONObject())
            } catch (_: Exception) {
                if (reply != null) reply(JSONObject().put("error", "Could not open Android sharing."))
                else failure("Could not open Android sharing.")
            }
        }
    }

    fun handle(type: String, message: JSONObject, reply: (JSONObject) -> Unit) {
        val epoch = generation
        val executor = if (type.startsWith("incoming.")) incomingWorker else worker
        executor.execute {
            try {
                if (type.startsWith("share.")) check(epoch == generation) { "The page changed before sharing finished." }
                when (type) {
                    "share.begin" -> {
                        check(current == null) { "Another file is being shared." }
                        val size = message.optLong("size", -1)
                        require(size in -1..(128L * 1024 * 1024)) { "Shared file is too large." }
                        val mime = message.optString("mime").takeIf { it.matches(Regex("[a-zA-Z0-9.+_-]+/[a-zA-Z0-9.+_-]+")) } ?: "application/octet-stream"
                        val file = destination(message.optString("filename"))
                        val id = UUID.randomUUID().toString()
                        current = Transfer(id, file, mime, ExportWriter(file.outputStream(), size, 128L * 1024 * 1024), epoch)
                        respond(reply, JSONObject().put("transfer", id))
                    }
                    "share.abort" -> {
                        val transfer = message.optString("transfer")
                        if (transfer.isEmpty() || current?.id == transfer) cancelCurrent()
                        respond(reply)
                    }
                    "share.chunk", "share.end" -> {
                        val transfer = current
                        check(transfer != null && transfer.id == message.optString("transfer")) { "The share is no longer available." }
                        when (type) {
                            "share.chunk" -> { transfer.writer.append(message.getLong("offset"), message.getString("data")); respond(reply) }
                            "share.end" -> { transfer.writer.finish(); current = null; offer(transfer.file, transfer.mime, reply, transfer.generation) }
                        }
                    }
                    "incoming.list" -> respond(reply, JSONObject().put("files", JSONArray().also { files ->
                        inbox.list().forEach { files.put(JSONObject().put("id", it.id).put("name", it.name).put("mime", it.mime).put("size", it.size)) }
                    }))
                    "incoming.read" -> respond(reply, JSONObject().put("data", Base64.getEncoder().encodeToString(inbox.read(message.getString("file"), message.getLong("offset")))))
                    "incoming.remove" -> { inbox.remove(message.getString("file")); respond(reply) }
                    else -> error("Unknown sharing operation.")
                }
            } catch (error: Exception) {
                if (type.startsWith("share.") && current?.id == message.optString("transfer")) cancelCurrent()
                respond(reply, JSONObject().put("error", error.message ?: "Could not share the file."))
            }
        }
    }

    fun capture(uris: List<Uri>, token: String) {
        incomingWorker.execute {
            if (uris.distinct().size > 20) ui { failure("Only the first 20 shared files can be received at once.") }
            for ((index, uri) in uris.distinct().take(20).withIndex()) {
                try {
                    require(uri.scheme == "content") { "The shared file must come from an Android content provider." }
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "shared-character.png"
                    require(Regex("\\.(a?png|json|charx)$", RegexOption.IGNORE_CASE).containsMatchIn(name)) { "Share a PNG, APNG, JSON or CHARX character card." }
                    val mime = when (name.substringAfterLast('.').lowercase()) { "json" -> "application/json"; "charx" -> "application/zip"; else -> "image/png" }
                    val extension = name.substringAfterLast('.').lowercase()
                    val filename = safeFilename(name.substringBeforeLast('.')).take(150) + "." + extension
                    inbox.put("${token}_$index", filename, mime) { context.contentResolver.openInputStream(uri) ?: error("Could not read the shared file.") }
                } catch (error: Exception) { ui { failure(error.message ?: "Could not read the shared file.") } }
            }
            ui { incoming() }
        }
    }

    private fun respond(reply: (JSONObject) -> Unit, result: JSONObject = JSONObject()) { ui { reply(result) } }
    private fun cancelCurrent() { current?.let { runCatching { it.writer.close() }; it.file.parentFile?.deleteRecursively() }; current = null }
    fun cancel() { generation++; worker.execute { cancelCurrent() } }
    fun close() { cancel(); worker.shutdown(); incomingWorker.shutdown() }
}
