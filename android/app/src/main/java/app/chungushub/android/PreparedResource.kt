package app.chungushub.android

/** Main-thread resource ownership: foreground warm-up and playback share one connection.
 * Releasing a waiting owner cancels its callback; late initialization can never revive it. */
class PreparedResource<T : Any>(
    private val now: () -> Long,
    private val begin: ((Result<T>) -> Unit) -> (() -> Unit)
) {
    data class Acquisition<T>(val value: T, val initializationMs: Long, val waitMs: Long, val reused: Boolean)
    private data class Waiting<T>(val at: Long, val callback: (Result<Acquisition<T>>) -> Unit)
    private val owners = mutableSetOf<Any>()
    private val waiting = mutableMapOf<Any, Waiting<T>>()
    private var generation = 0
    private var starting = false
    private var close: (() -> Unit)? = null
    private var initializationMs = 0L
    var value: T? = null
        private set

    fun retain(owner: Any) { owners.add(owner); ensure() }
    fun acquire(owner: Any, callback: (Result<Acquisition<T>>) -> Unit) {
        owners.add(owner)
        value?.let { callback(Result.success(Acquisition(it, initializationMs, 0, true))); return }
        waiting[owner] = Waiting(now(), callback)
        ensure()
    }
    fun release(owner: Any) {
        owners.remove(owner); waiting.remove(owner)
        if (owners.isEmpty()) dispose()
    }
    /** Invalid engines are never returned to the warm cache. Retry on the next explicit request. */
    fun invalidate() {
        val callbacks = waiting.values.toList()
        waiting.clear(); dispose()
        callbacks.forEach { it.callback(Result.failure(IllegalStateException("The speech engine was reset."))) }
    }
    private fun dispose() {
        generation++; starting = false; value = null
        val previous = close; close = null
        previous?.invoke()
    }
    private fun ensure() {
        if (starting || value != null) return
        starting = true
        val attempt = ++generation
        val at = now()
        val cleanup = begin { result ->
            if (attempt != generation) return@begin
            starting = false
            initializationMs = (now() - at).coerceAtLeast(0)
            value = result.getOrNull()
            val callbacks = waiting.toMap(); waiting.clear()
            if (result.isFailure) dispose()
            callbacks.forEach { (owner, waiter) ->
                if (owner in owners) waiter.callback(result.map {
                    Acquisition(it, initializationMs, (now() - waiter.at).coerceAtLeast(0), false)
                })
            }
        }
        // Also handles a synchronous failure from a factory that could not start.
        if (attempt == generation) close = cleanup else cleanup()
    }
}
