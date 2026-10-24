package app.chungushub.android

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.MediaPlayer
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Owns speech independently of the WebView. Only the explicit, non-exported service
 * receives text; the OS media session receives transport commands, never credentials. */
class ReadAloudService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var session: MediaSession
    private lateinit var audio: AudioManager
    private lateinit var focus: AudioFocusRequest
    private lateinit var cache: File
    private lateinit var preparingLock: PowerManager.WakeLock
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var boundEngine = ""
    private var defaultVoice: android.speech.tts.Voice? = null
    private var options = SpeechOptions()
    private var initialization = 0
    private val speechOwner = Any()
    private var startup: JSONObject? = null
    private var closed = false
    private var origin = ""
    private var title = "Chungus"
    private var parts = emptyList<String>()
    private var index = 0
    private var wantsPlay = false
    private var hasFocus = false
    private var resumeAfterFocus = false
    private var phase = "idle"
    private var error: String? = null
    private var player: MediaPlayer? = null
    private var playerReady = false
    private val files = mutableMapOf<Int, File>()
    private data class Pending(val id: String, val index: Int, val file: File)
    private var pending: Pending? = null
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val artwork by lazy { BitmapFactory.decodeResource(resources, R.mipmap.chungus) }
    private val idleTimeout = Runnable { finishReading() }
    private val synthesisTimeout = Runnable { fail("The speech engine took too long. Try reading the message again.") }
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) { if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pause() }
    }

    override fun onCreate() {
        super.onCreate()
        cache = File(cacheDir, "read-aloud").apply { mkdirs() }
        cache.listFiles()?.forEach { it.delete() }
        preparingLock = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:tts-preparation")
        audio = getSystemService(AudioManager::class.java)
        focus = createAudioFocus(mixAudio = false)
        session = MediaSession(this, "ChungusReadAloud").apply {
            setSessionActivity(PendingIntent.getActivity(this@ReadAloudService, 0,
                Intent(this@ReadAloudService, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = play()
                override fun onPause() = pause()
                override fun onStop() = finishReading()
                override fun onSkipToPrevious() = skip(-1)
                override fun onSkipToNext() = skip(1)
            }, main)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Read aloud", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Controls for reading chat messages aloud"
                setSound(null, null)
            })
        ContextCompat.registerReceiver(this, noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
        instance = this
    }

    private fun createAudioFocus(mixAudio: Boolean): AudioFocusRequest {
        val gain = if (mixAudio) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK else AudioManager.AUDIOFOCUS_GAIN
        lateinit var request: AudioFocusRequest
        request = AudioFocusRequest.Builder(gain).setAudioAttributes(attributes)
            .setWillPauseWhenDucked(true).setOnAudioFocusChangeListener({ change ->
                // A delayed callback from a previous reading cannot pause the new one.
                if (closed || focus !== request) return@setOnAudioFocusChangeListener
                when (change) {
                    AudioManager.AUDIOFOCUS_GAIN -> {
                        hasFocus = true
                        if (resumeAfterFocus) { resumeAfterFocus = false; play() }
                    }
                    AudioManager.AUDIOFOCUS_LOSS -> { hasFocus = false; pause(); abandonFocus() }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                        val resume = wantsPlay
                        hasFocus = false
                        pause(releaseFocus = false)
                        resumeAfterFocus = resume
                    }
                }
            }, main).build()
        return request
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action != START) { finishReading(); return START_NOT_STICKY }
        // Foreground before requesting audio focus (required on Android 15+) or TTS IO.
        origin = intent.getStringExtra("origin").orEmpty()
        title = intent.getStringExtra("title").orEmpty().take(180).ifBlank { "Chungus" }
        phase = "preparing"
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIFICATION, notification())
        try {
            resetAudio()
            parts = SpeechText.sentences(intent.getStringExtra("text").orEmpty(), minOf(3000, TextToSpeech.getMaxSpeechInputLength()))
            index = 0
            wantsPlay = true
            error = null
            session.isActive = true
            options = SpeechPreferences.load(this)
            // resetAudio abandoned the previous request. Keep this policy for the whole reading.
            focus = createAudioFocus(options.mixAudio)
            startup = null
            // The pool checks the current default engine and measures warm/cold acquisition.
            ttsReady = false
            initializeSpeech()
            play()
        } catch (e: Exception) { fail(e.message ?: "Could not start reading.") }
        return START_NOT_STICKY
    }

    private fun initializeSpeech() {
        val attempt = ++initialization
        preparingLock.acquire(45000)
        SpeechEnginePool.acquire(applicationContext, speechOwner) { result ->
            if (closed || attempt != initialization) return@acquire
            releasePreparationLock()
            val acquired = result.getOrElse { fail(it.message ?: "Could not start the speech engine."); return@acquire }
            val engine = acquired.value.tts
            tts = engine
            boundEngine = acquired.value.id
            defaultVoice = acquired.value.defaultVoice
            startup = JSONObject().put("engineInitializationMs", acquired.initializationMs)
                .put("engineWaitMs", acquired.waitMs).put("engineReused", acquired.reused)
            Log.d("ChungusTTS", "engine_wait_ms=${acquired.waitMs} engine_initialization_ms=${acquired.initializationMs} reused=${acquired.reused}")
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { main.post { synthesized(utteranceId) } }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { main.post { synthesisFailed(utteranceId) } }
                override fun onError(utteranceId: String?, errorCode: Int) { main.post { synthesisFailed(utteranceId) } }
            })
            ttsReady = true
            try { configureSpeech() } catch (e: Exception) { fail(e.message ?: "Could not configure the voice."); return@acquire }
            if (wantsPlay && hasFocus) ensureAudio()
        }
    }

    private fun configureSpeech() {
        val engine = tts ?: return
        val voice = if (options.voice.isNotBlank()) {
            check(options.engine == boundEngine) { "The Android speech engine changed. Choose a voice again in Settings → TTS." }
            engine.voices.orEmpty().find { it.name == options.voice && !it.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
                ?: error("The selected voice is no longer available. Choose another in Settings → TTS.")
        } else defaultVoice
        if (voice != null) check(engine.setVoice(voice) == TextToSpeech.SUCCESS) { "The speech engine could not use this voice. Choose another in Settings → TTS." }
        check(engine.setSpeechRate(options.rate) == TextToSpeech.SUCCESS) { "The speech engine could not apply the reading speed." }
    }

    private fun play() {
        if (closed || parts.isEmpty() || phase == "error") return
        main.removeCallbacks(idleTimeout)
        resumeAfterFocus = false
        if (!hasFocus) hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (!hasFocus) { pause(); return }
        wantsPlay = true
        if (playerReady) {
            try { player?.start(); phase = "playing"; publish() }
            catch (_: Exception) { fail("Could not resume the audio.") }
        } else { phase = "preparing"; publish(); ensureAudio() }
    }

    private fun pause(releaseFocus: Boolean = true) {
        if (closed || parts.isEmpty() || phase == "error") return
        wantsPlay = false
        resumeAfterFocus = false
        if (playerReady) runCatching { player?.pause() }
        phase = "paused"
        if (releaseFocus) abandonFocus()
        main.removeCallbacks(idleTimeout)
        main.postDelayed(idleTimeout, 10 * 60 * 1000L)
        publish()
    }

    private fun skip(delta: Int) {
        if (closed || parts.isEmpty() || phase == "error") return
        val target = (index + delta).coerceIn(0, parts.lastIndex)
        if (target == index && delta > 0) return
        releasePlayer()
        // Natural completion can reach the next sentence while it is still being
        // synthesized. Preserve that work rather than cancelling and starting over.
        if (pending?.index != target) cancelSynthesis()
        index = target
        files.entries.removeAll { (i, file) -> if (i !in index..index + 1) { file.delete(); true } else false }
        phase = if (wantsPlay) "preparing" else "paused"
        publish()
        if (wantsPlay) ensureAudio()
    }

    private fun ensureAudio() {
        if (closed || !wantsPlay || !ttsReady || phase == "error") return
        val file = files[index]
        if (player == null && file != null) {
            val current = MediaPlayer()
            player = current
            try {
                current.setAudioAttributes(attributes)
                current.setWakeMode(applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                current.setOnPreparedListener {
                    if (player !== current || closed) return@setOnPreparedListener
                    playerReady = true
                    if (wantsPlay && hasFocus) { current.start(); phase = "playing"; publish(); ensureAudio() }
                }
                current.setOnCompletionListener {
                    if (player !== current || closed) return@setOnCompletionListener
                    if (index == parts.lastIndex) finishReading() else skip(1)
                }
                current.setOnErrorListener { _, _, _ ->
                    if (player === current && !closed) fail("Could not play the speech audio.")
                    true
                }
                current.setDataSource(file.absolutePath)
                current.prepareAsync()
            } catch (_: Exception) { fail("Could not prepare the speech audio."); return }
        }
        // Keep only the current sentence and one ahead. No whole-message audio file.
        if (pending == null) {
            val needed = if (file == null) index else index + 1
            if (needed < parts.size && files[needed] == null) synthesize(needed)
        }
    }

    private fun synthesize(part: Int) {
        val id = UUID.randomUUID().toString()
        val file = File(cache, "$id.wav")
        pending = Pending(id, part, file)
        preparingLock.acquire(45000)
        main.postDelayed(synthesisTimeout, 45000)
        if (tts?.synthesizeToFile(parts[part], Bundle(), file, id) != TextToSpeech.SUCCESS) synthesisFailed(id)
    }

    private fun synthesized(id: String?) {
        val task = pending?.takeIf { it.id == id && !closed } ?: return
        pending = null
        main.removeCallbacks(synthesisTimeout)
        releasePreparationLock()
        if (!task.file.isFile || task.file.length() <= 44 || task.file.length() > 32 * 1024 * 1024L) {
            task.file.delete(); fail("The speech engine did not produce usable audio."); return
        }
        files[task.index] = task.file
        if (wantsPlay) ensureAudio()
    }

    private fun synthesisFailed(id: String?) {
        if (pending?.id != id || closed) return
        fail("Could not generate speech. Check the installed voice and its network requirements.")
    }

    private fun releasePreparationLock() { if (preparingLock.isHeld) preparingLock.release() }
    private fun cancelSynthesis() {
        val task = pending
        pending = null // Invalidate before stop callbacks can arrive from the engine.
        tts?.stop()
        task?.file?.delete()
        main.removeCallbacks(synthesisTimeout)
        releasePreparationLock()
    }
    private fun releasePlayer() { player?.release(); player = null; playerReady = false }
    private fun releaseSpeech(invalid: Boolean = false) {
        tts?.setOnUtteranceProgressListener(null)
        tts = null; ttsReady = false
        SpeechEnginePool.release(speechOwner)
        if (invalid) SpeechEnginePool.invalidate()
    }
    private fun abandonFocus() { audio.abandonAudioFocusRequest(focus); hasFocus = false; resumeAfterFocus = false }
    private fun resetAudio() {
        wantsPlay = false
        main.removeCallbacks(idleTimeout)
        releasePlayer()
        cancelSynthesis()
        files.values.forEach { it.delete() }; files.clear()
        abandonFocus()
    }
    private fun fail(message: String) {
        if (closed) return
        resetAudio()
        initialization++
        releaseSpeech(invalid = true)
        phase = "error"; error = message
        publish()
        stopForeground(STOP_FOREGROUND_REMOVE)
        main.postDelayed(idleTimeout, 60000)
    }
    private fun finishReading() {
        if (closed) return
        closed = true
        resetAudio()
        parts = emptyList()
        phase = "idle"
        notifyObservers()
        session.isActive = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    private fun status(): JSONObject = JSONObject().put("phase", phase).put("title", title)
        .put("sentence", index + 1).put("total", parts.size).put("error", error ?: JSONObject.NULL)
        .put("startup", startup ?: JSONObject.NULL)

    // Only a MediaStyle notification with an active session token is posted here.
    // Media-session notifications are exempt from POST_NOTIFICATIONS (Android docs).
    @SuppressLint("NotificationPermission")
    private fun publish() {
        if (closed) return
        notifyObservers()
        val actions = PlaybackState.ACTION_STOP or PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
            (if (index < parts.lastIndex) PlaybackState.ACTION_SKIP_TO_NEXT else 0L)
        val state = when (phase) {
            "playing" -> PlaybackState.STATE_PLAYING
            "preparing" -> PlaybackState.STATE_BUFFERING
            "error" -> PlaybackState.STATE_ERROR
            else -> PlaybackState.STATE_PAUSED
        }
        session.setPlaybackState(PlaybackState.Builder().setActions(actions)
            .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (phase == "playing") 1f else 0f).build())
        session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, "Chungus · Read aloud")
            .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, "Sentence ${index + 1} of ${parts.size}").build())
        if (phase != "error") getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
    }

    private fun notification(): Notification {
        val toggle = if (wantsPlay) "pause" else "play"
        return Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_read_aloud).setLargeIcon(artwork)
            .setContentTitle(title).setContentText(if (phase == "preparing") "Preparing speech…" else "Sentence ${index + 1} of ${parts.size}")
            .setContentIntent(session.controller.sessionActivity).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setOnlyAlertOnce(true).setShowWhen(false).setCategory(Notification.CATEGORY_TRANSPORT)
            .setOngoing(wantsPlay).setDeleteIntent(commandIntent("stop"))
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_previous), "Previous sentence", commandIntent("previous")).build())
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, if (wantsPlay) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play),
                if (wantsPlay) "Pause" else "Play", commandIntent(toggle)).build())
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_media_next), "Next sentence", commandIntent("next")).build())
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel), "Stop", commandIntent("stop")).build())
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
    }

    private fun commandIntent(action: String): PendingIntent = PendingIntent.getBroadcast(this, action.hashCode(),
        Intent(this, ReadAloudControls::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() {
        closed = true
        resetAudio()
        main.removeCallbacksAndMessages(null)
        initialization++
        releaseSpeech()
        session.release()
        unregisterReceiver(noisy)
        cache.listFiles()?.forEach { it.delete() }
        if (instance === this) instance = null
        notifyObservers()
        super.onDestroy()
    }

    companion object {
        private const val START = "app.chungushub.android.READ_ALOUD"
        private const val CHANNEL = "read-aloud"
        private const val NOTIFICATION = 40
        private var instance: ReadAloudService? = null
        private val observers = mutableSetOf<() -> Unit>()
        private fun notifyObservers() { observers.toList().forEach { it() } }
        fun observe(callback: () -> Unit): () -> Unit {
            observers.add(callback)
            return { observers.remove(callback) }
        }
        fun start(context: Context, origin: String, text: String, title: String) {
            require(text.isNotBlank() && text.length <= SpeechText.MAX_TEXT) { "The message is empty or too long to read (maximum 80,000 characters)." }
            ContextCompat.startForegroundService(context, Intent(context, ReadAloudService::class.java).setAction(START)
                .putExtra("origin", origin).putExtra("text", text).putExtra("title", title.take(180)))
        }
        fun snapshot(origin: String): JSONObject = instance?.takeIf { !it.closed && it.origin == origin }?.status()
            ?: JSONObject().put("phase", "idle")
        fun serverChanged(origin: String) {
            instance?.takeIf { it.origin != origin }?.finishReading()
        }
        fun command(action: String, origin: String? = null) {
            val current = instance?.takeIf { !it.closed && (origin == null || it.origin == origin) } ?: return
            when (action) {
                "play" -> current.play()
                "pause" -> current.pause()
                "previous" -> current.skip(-1)
                "next" -> current.skip(1)
                "stop" -> current.finishReading()
            }
        }
    }
}

/** Explicit immutable notification PendingIntents only; no exported command receiver. */
class ReadAloudControls : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { ReadAloudService.command(intent.action.orEmpty()) }
}
