package app.chungushub.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.Voice
import android.util.Log

/** Holds only a TTS connection, never audio focus, a wake lock or a foreground service.
 * Activities retain it while visible/unlocked; an active reader retains it independently. */
object SpeechEnginePool {
    data class Engine(val tts: TextToSpeech, val id: String, val defaultVoice: Voice?)
    private var resource: PreparedResource<Engine>? = null
    private fun connection(context: Context): PreparedResource<Engine> {
        resource?.let { return it }
        val app = context.applicationContext
        val main = Handler(Looper.getMainLooper())
        return PreparedResource<Engine>(SystemClock::elapsedRealtime) { complete ->
            val at = SystemClock.elapsedRealtime()
            var engine: TextToSpeech? = null
            var cancelled = false
            var finished = false
            val timeout = Runnable {
                if (!cancelled && !finished) {
                    finished = true
                    complete(Result.failure(IllegalStateException("The speech engine did not start. Check your Android text-to-speech settings.")))
                }
            }
            main.postDelayed(timeout, 45000)
            try {
                engine = TextToSpeech(app) { status -> main.post {
                    if (cancelled || finished) return@post
                    finished = true; main.removeCallbacks(timeout)
                    val result = runCatching {
                        check(status == TextToSpeech.SUCCESS) { "No speech engine is available. Check Android text-to-speech settings." }
                        val tts = engine ?: error("The speech engine is unavailable.")
                        Engine(tts, tts.defaultEngine.orEmpty(), tts.voice)
                    }
                    Log.d("ChungusTTS", "engine_initialization_ms=${SystemClock.elapsedRealtime() - at} success=${result.isSuccess}")
                    complete(result)
                } }
            } catch (error: Exception) {
                finished = true; main.removeCallbacks(timeout); complete(Result.failure(error))
            }
            val cleanup: () -> Unit = {
                cancelled = true; main.removeCallbacks(timeout)
                engine?.setOnUtteranceProgressListener(null)
                engine?.shutdown(); engine = null
            }
            cleanup
        }.also { resource = it }
    }
    fun foreground(context: Context, owner: Any, active: Boolean) {
        if (active) connection(context).retain(owner) else resource?.release(owner)
    }
    fun acquire(context: Context, owner: Any, callback: (Result<PreparedResource.Acquisition<Engine>>) -> Unit) {
        val pool = connection(context)
        // Re-evaluate the system default between readings, never during active synthesis.
        pool.value?.let { if (it.id != it.tts.defaultEngine.orEmpty()) pool.invalidate() }
        pool.acquire(owner, callback)
    }
    fun release(owner: Any) { resource?.release(owner) }
    fun invalidate() { resource?.invalidate() }
}
