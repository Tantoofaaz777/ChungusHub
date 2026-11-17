package app.chungushub.android

import org.json.JSONObject
import java.io.File
import java.net.URL
import javax.net.ssl.HttpsURLConnection

data class EdgeSpeechChoice(val voice: String, val rate: Float) {
    init {
        require(voice.matches(Regex("en-(US|GB)-[A-Za-z]{1,64}Neural"))) { "Choose a US or UK English Edge voice." }
        require(rate.isFinite() && rate in SpeechOptions.MIN_RATE..SpeechOptions.MAX_RATE) { "Invalid reading speed." }
    }
}

/** One cancellable download from the selected ChungusHub server. The WebView's
 * session cookie stays in memory and is sent only to that HTTPS origin. */
class EdgeSpeechDownload(private val url: String, private val cookie: String?) {
    @Volatile private var cancelled = false
    @Volatile private var connection: HttpsURLConnection? = null

    fun cancel() {
        cancelled = true
        connection?.disconnect()
    }

    fun save(text: String, choice: EdgeSpeechChoice, file: File) {
        val request = URL(url).openConnection() as HttpsURLConnection
        connection = request
        var complete = false
        try {
            check(!cancelled)
            request.instanceFollowRedirects = false
            request.connectTimeout = 10_000
            request.readTimeout = 20_000
            request.requestMethod = "POST"
            request.setRequestProperty("Content-Type", "application/json")
            if (!cookie.isNullOrBlank()) request.setRequestProperty("Cookie", cookie)
            request.doOutput = true
            val input = JSONObject().put("text", text).put("voice", choice.voice)
                .put("rate", choice.rate.toDouble()).toString().toByteArray(Charsets.UTF_8)
            request.setFixedLengthStreamingMode(input.size)
            request.outputStream.use { it.write(input) }
            when (request.responseCode) {
                200 -> if (request.contentType != "audio/mpeg") throw EdgeSpeechFailure("The server did not return speech audio.")
                401, 403 -> throw EdgeSpeechFailure("Unlock ChungusHub and try reading again.")
                429 -> throw EdgeSpeechFailure("Edge TTS is busy. Wait a moment and try again.")
                404 -> throw EdgeSpeechFailure("Update the ChungusHub server to use Edge TTS.")
                else -> throw EdgeSpeechFailure("Could not generate audio with Edge TTS. Try again in a moment.")
            }
            request.inputStream.use { audio -> file.outputStream().use { output ->
                val buffer = ByteArray(8192)
                var total = 0
                while (!cancelled) {
                    val count = audio.read(buffer)
                    if (count == -1) break
                    total += count
                    check(total <= 4 * 1024 * 1024)
                    output.write(buffer, 0, count)
                }
                check(!cancelled && total > 44)
                complete = true
            } }
        } finally {
            request.disconnect()
            connection = null
            if (!complete || cancelled) file.delete()
        }
    }

    companion object {
        fun url(origin: String): String = ServerAddress.parse(origin).origin + "/api/tts/synthesize"
    }
}

class EdgeSpeechFailure(message: String) : Exception(message)
