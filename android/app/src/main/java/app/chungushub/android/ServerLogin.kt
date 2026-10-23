package app.chungushub.android

import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

class LoginRejected(val status: Int, message: String) : Exception(message)

object ServerLogin {
    /** No existing WebView cookie is sent: every unlock really verifies the server password. */
    fun authenticate(server: ServerAddress, password: String): String {
        require(password.isNotEmpty()) { "Enter your server password." }
        val connection = URL(server.origin + "/api/auth/login").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false // Never forward a password to a redirected host.
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.requestMethod = "POST"
            // This is a native request with no ambient WebView cookies. The server's
            // non-browser CSRF path also works behind proxies that rewrite Host.
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            val body = JSONObject().put("password", password).toString().toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
            return sessionCookie(connection.responseCode, connection.headerFields.entries
                .filter { it.key.equals("set-cookie", true) }.flatMap { it.value.orEmpty() })
        } finally { connection.disconnect() }
    }

    fun sessionCookie(status: Int, cookies: List<String>): String {
        if (status != 200) throw LoginRejected(status, when (status) {
            401 -> "Wrong server password. Please try again."
            429 -> "Too many attempts. Wait 30 seconds and try again."
            403 -> "This device is not allowed to access the server."
            in 300..399 -> "The server redirected sign-in. Check the HTTPS server address."
            else -> "Could not sign in to the server. Please try again."
        })
        return cookies.firstOrNull { it.matches(Regex("chungus_session=[a-f0-9]{64};.*", RegexOption.IGNORE_CASE)) }
            ?: throw LoginRejected(200, "The server did not return a valid session. Check the server address.")
    }
}
