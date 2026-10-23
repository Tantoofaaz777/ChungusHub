package app.chungushub.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Voice discovery never starts playback or a foreground service. Its temporary TTS
 * connection is separate from the active player and is closed after enumeration. */
class SpeechSettings(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var reply: ((JSONObject) -> Unit)? = null
    private var generation = 0
    private var closed = false
    private var catalogEngine: String? = null
    private var voiceNames = emptySet<String>()
    private val timeout = Runnable { complete(JSONObject().put("error", "The speech engine took too long to list voices. Try again.")) }

    fun load(callback: (JSONObject) -> Unit) {
        check(!closed) { "Voice settings have closed." }
        if (reply != null) { callback(JSONObject().put("error", "Voices are already loading. Please wait.")); return }
        reply = callback
        val attempt = ++generation
        main.postDelayed(timeout, 20000)
        try {
            engine = TextToSpeech(context.applicationContext) { status -> main.post {
                if (closed || generation != attempt || reply == null) return@post
                try {
                    check(status == TextToSpeech.SUCCESS) { "No speech engine is available. Check Android text-to-speech settings." }
                    val tts = engine ?: error("The speech engine is unavailable.")
                    val engineId = tts.defaultEngine.orEmpty()
                    val voices = tts.voices.orEmpty().filter {
                        it.name.length <= 512 && !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
                    }.sortedWith(compareBy({ it.locale.toLanguageTag() }, { it.name }))
                    catalogEngine = engineId
                    voiceNames = voices.map { it.name }.toSet()
                    val options = SpeechPreferences.load(context)
                    val payload = JSONObject().put("engine", engineId)
                        .put("engineLabel", tts.engines.find { it.name == engineId }?.label ?: engineId)
                        .put("voice", options.voice).put("rate", options.rate)
                        .put("defaultVoice", tts.defaultVoice?.name.orEmpty())
                        .put("selectionAvailable", options.voice.isBlank() || (options.engine == engineId && options.voice in voiceNames))
                        .put("voices", JSONArray().apply { voices.forEach { voice -> put(JSONObject()
                            .put("id", voice.name).put("language", voice.locale.toLanguageTag())
                            .put("languageLabel", voice.locale.getDisplayName(Locale.ENGLISH))
                            .put("network", voice.isNetworkConnectionRequired)) } })
                    complete(JSONObject().put("settings", payload))
                } catch (e: Exception) { complete(JSONObject().put("error", e.message ?: "Could not list voices.")) }
            } }
        } catch (e: Exception) { complete(JSONObject().put("error", e.message ?: "Could not start the speech engine.")) }
    }

    fun save(message: JSONObject): JSONObject {
        check(!closed) { "Voice settings have closed." }
        val selectedEngine = message.getString("engine")
        val voice = message.getString("voice")
        check(catalogEngine != null && selectedEngine == catalogEngine) { "Reload the voice list before saving." }
        require(voice.isBlank() || voice in voiceNames) { "This voice is no longer available. Reload the voice list." }
        val options = SpeechOptions.checked(selectedEngine, voice, message.getDouble("rate").toFloat())
        SpeechPreferences.save(context, options)
        return JSONObject().put("voice", options.voice).put("rate", options.rate).put("engine", selectedEngine)
    }

    private fun complete(result: JSONObject) {
        val callback = reply ?: return
        reply = null
        generation++
        main.removeCallbacks(timeout)
        engine?.shutdown(); engine = null
        callback(result)
    }

    fun close() {
        closed = true
        generation++
        reply = null
        main.removeCallbacksAndMessages(null)
        engine?.shutdown(); engine = null
    }
}
