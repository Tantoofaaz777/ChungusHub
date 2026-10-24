package app.chungushub.android

import android.content.Context
import kotlin.math.round

/** Device-local synthesis choices, captured once per reading, never synced to a server. */
data class SpeechOptions(val engine: String = "", val voice: String = "", val rate: Float = 1f, val mixAudio: Boolean = false) {
    companion object {
        const val MIN_RATE = 0.5f
        const val MAX_RATE = 2f
        fun checked(engine: String, voice: String, rate: Float, mixAudio: Boolean = false): SpeechOptions {
            require(engine.length <= 512 && voice.length <= 512) { "Invalid voice selection." }
            require(rate.isFinite() && rate in MIN_RATE..MAX_RATE) { "Reading speed must be between 0.5× and 2×." }
            return SpeechOptions(if (voice.isBlank()) "" else engine, voice.ifBlank { "" }, round(rate * 100) / 100, mixAudio)
        }
    }
}

object SpeechPreferences {
    private fun store(context: Context) = context.getSharedPreferences("read-aloud", Context.MODE_PRIVATE)
    fun load(context: Context): SpeechOptions = runCatching {
        val prefs = store(context)
        SpeechOptions.checked(prefs.getString("engine", "").orEmpty(), prefs.getString("voice", "").orEmpty(), prefs.getFloat("rate", 1f), prefs.getBoolean("mixAudio", false))
    }.getOrDefault(SpeechOptions())

    fun save(context: Context, options: SpeechOptions) {
        store(context).edit().putString("engine", options.engine).putString("voice", options.voice).putFloat("rate", options.rate)
            .putBoolean("mixAudio", options.mixAudio).apply()
    }
}
