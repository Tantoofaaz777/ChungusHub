package app.chungushub.android

import java.net.URI
import java.util.Locale

data class ServerAddress(val url: String, val origin: String) {
    fun trusts(value: String): Boolean = runCatching { originOf(URI(value)) == origin }.getOrDefault(false)

    companion object {
        fun parse(input: String): ServerAddress {
            val trimmed = input.trim()
            require(trimmed.isNotEmpty()) { "Enter the server address." }
            val uri = URI(if (trimmed.contains("://")) trimmed else "https://$trimmed").parseServerAuthority()
            require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) {
                "Use the HTTPS address without credentials, query parameters or fragments."
            }
            val origin = originOf(uri)
            require(origin != null) { "Enter a valid HTTPS address." }
            val path = uri.normalize().rawPath.orEmpty().ifEmpty { "/" }
            return ServerAddress(origin + path, origin)
        }

        private fun originOf(uri: URI): String? {
            if (!uri.scheme.equals("https", true) || uri.rawUserInfo != null) return null
            val host = uri.host?.lowercase(Locale.ROOT) ?: return null
            if (host.isBlank() || uri.port == 0 || uri.port < -1 || uri.port > 65535) return null
            return "https://$host" + if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
        }
    }
}

/** Used only as a suggested document name; the Android picker owns the destination. */
fun safeFilename(input: String): String = input.substringAfterLast('/').substringAfterLast('\\')
    .replace(Regex("[\\p{Cntrl}:*?\"<>|]"), "_").trim().take(180).ifBlank { "chungus-export" }
