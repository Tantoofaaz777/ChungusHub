package app.chungushub.android

/** Monotonic time only: changing the phone clock must not extend the grace period. */
class LockState(var delayMillis: Long = 60_000) {
    var locked = true
        private set
    private var leftAt: Long? = null

    fun unlock() { locked = false; leftAt = null }
    fun lock() { locked = true }
    fun background(now: Long) { if (leftAt == null) leftAt = now }
    fun foreground(now: Long) {
        leftAt?.let { if (now < it || now - it >= delayMillis) locked = true }
        leftAt = null
    }

    companion object {
        val delays = listOf(0L, 30_000L, 60_000L, 300_000L, 900_000L)
        val labels = listOf("Immediately", "30 seconds", "1 minute", "5 minutes", "15 minutes")
    }
}
