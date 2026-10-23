package app.chungushub.android

/** Monotonic time only: changing the phone clock must not extend the grace period. */
class LockState(var delayMillis: Long = 60_000) {
    var locked = true
        private set
    var resumed = false
        private set
    /** Losing focus to a system dialog must not show a sign-in form behind it. */
    val showUnlock: Boolean get() = resumed && locked
    private var leftAt: Long? = null
    private var biometricAttempted = false

    fun unlock() { locked = false; leftAt = null; biometricAttempted = false }
    fun lock() { locked = true }
    /** One automatic attempt per lock, never on focus restoration after Cancel or an error. */
    fun takeBiometricAttempt(eligible: Boolean, windowFocused: Boolean): Boolean {
        if (!showUnlock || !eligible || !windowFocused || biometricAttempted) return false
        biometricAttempted = true
        return true
    }
    /** A manual login takes precedence over an automatic attempt queued for the next frame. */
    fun suppressAutomaticBiometrics() { biometricAttempted = true }
    fun pause() { resumed = false }
    /** Called onStop, when the activity is fully hidden, rather than merely paused. */
    fun background(now: Long) { pause(); if (leftAt == null) leftAt = now }
    fun foreground(now: Long) {
        resumed = true
        leftAt?.let { if (now < it || now - it >= delayMillis) locked = true }
        leftAt = null
    }

    companion object {
        val delays = listOf(0L, 30_000L, 60_000L, 300_000L, 900_000L)
        val labels = listOf("Immediately", "30 seconds", "1 minute", "5 minutes", "15 minutes")
    }
}
