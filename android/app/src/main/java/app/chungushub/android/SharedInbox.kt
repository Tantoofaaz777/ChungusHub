package app.chungushub.android

import java.io.File
import java.io.InputStream
import java.io.RandomAccessFile
import java.util.Properties

/** Private, durable copies of incoming cards. No URI or filesystem path reaches JavaScript. */
class SharedInbox(private val root: File, private val maxBytes: Long = 128L * 1024 * 1024, private val maxTotalBytes: Long = 256L * 1024 * 1024) {
    data class Item(val id: String, val name: String, val mime: String, val size: Long)
    private fun file(id: String, suffix: String): File {
        require(id.matches(Regex("[a-f0-9-]{36}_[0-9]{1,2}"))) { "Invalid shared file." }
        return File(root, "$id.$suffix")
    }
    private fun item(id: String): Item? = runCatching {
            val manifest = file(id, "properties")
            val properties = Properties().apply { manifest.inputStream().use { load(it) } }
            val size = properties.getProperty("size").toLong()
            require(size in 1..maxBytes && file(id, "bin").length() == size)
            Item(id, properties.getProperty("name"), properties.getProperty("mime"), size)
        }.getOrNull()
    fun list(): List<Item> = root.listFiles().orEmpty().filter { it.extension == "properties" }
        .sortedBy { it.lastModified() }.mapNotNull { item(it.nameWithoutExtension) }

    fun put(id: String, name: String, mime: String, input: () -> InputStream): Item {
        item(id)?.let { return it }
        require(list().size < 20) { "Import or cancel the pending shared files first (maximum 20)." }
        val remaining = maxTotalBytes - list().sumOf { it.size }
        root.mkdirs()
        val bytes = file(id, "bin")
        val manifest = file(id, "properties")
        try {
            var size = 0L
            input().use { source -> bytes.outputStream().use { output ->
                val buffer = ByteArray(49152)
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) break
                    size += count
                    require(size <= maxBytes) { "Shared character is too large (maximum 128 MiB)." }
                    require(size <= remaining) { "Import or cancel the pending shared files first (maximum 256 MiB)." }
                    output.write(buffer, 0, count)
                }
            } }
            require(size > 0) { "Shared file is empty." }
            Properties().apply {
                setProperty("name", name); setProperty("mime", mime); setProperty("size", size.toString())
            }.also { properties -> manifest.outputStream().use { properties.store(it, null) } }
            return Item(id, name, mime, size)
        } catch (error: Exception) { manifest.delete(); bytes.delete(); throw error }
    }

    fun read(id: String, offset: Long): ByteArray {
        val item = item(id) ?: error("The shared file is no longer available.")
        require(offset in 0 until item.size) { "Invalid shared file offset." }
        return RandomAccessFile(file(id, "bin"), "r").use { input ->
            input.seek(offset)
            ByteArray(minOf(49152L, item.size - offset).toInt()).also { input.readFully(it) }
        }
    }

    fun remove(id: String) {
        for (suffix in listOf("properties", "bin")) {
            val target = file(id, suffix)
            check(!target.exists() || target.delete()) { "Could not clear the shared file." }
        }
    }
}
