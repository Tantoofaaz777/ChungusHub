package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class PreparedResourceTest {
    private class Harness {
        var clock = 0L
        var starts = 0
        var stops = 0
        val completions = mutableListOf<(Result<String>) -> Unit>()
        val resource = PreparedResource<String>({ clock }) { complete ->
            starts++; completions.add(complete)
            val cleanup: () -> Unit = { stops++ }
            cleanup
        }
        fun ready() { completions.last()(Result.success("engine-$starts")) }
    }
    @Test fun foregroundWarmupRemovesInitializationWaitFromPlayback() {
        val h = Harness()
        h.resource.retain("activity")
        h.clock = 180; h.ready()
        h.clock = 1000
        var reading: PreparedResource.Acquisition<String>? = null
        h.resource.acquire("service") { reading = it.getOrThrow() }
        assertEquals(1, h.starts)
        assertEquals(180L, reading!!.initializationMs)
        assertEquals(0L, reading!!.waitMs)
        assertTrue(reading!!.reused)
    }
    @Test fun tappingDuringWarmupWaitsOnlyForRemainingInitialization() {
        val h = Harness()
        h.resource.retain("activity")
        h.clock = 120
        var reading: PreparedResource.Acquisition<String>? = null
        h.resource.acquire("service") { reading = it.getOrThrow() }
        h.clock = 180; h.ready()
        assertEquals(1, h.starts)
        assertEquals(180L, reading!!.initializationMs)
        assertEquals(60L, reading!!.waitMs)
        assertFalse(reading!!.reused)
    }
    @Test fun playbackRetainsEngineAcrossBackgroundAndReleasesWhenFinished() {
        val h = Harness()
        h.resource.retain("activity"); h.ready()
        h.resource.acquire("service") { it.getOrThrow() }
        h.resource.release("activity")
        assertEquals(0, h.stops)
        h.resource.release("service")
        assertEquals(1, h.stops)
        assertNull(h.resource.value)
    }
    @Test fun completedReadingReturnsEngineToVisibleActivityWithoutRestarting() {
        val h = Harness()
        h.resource.retain("activity"); h.ready()
        repeat(3) {
            h.resource.acquire("service") { result -> assertTrue(result.getOrThrow().reused) }
            h.resource.release("service")
        }
        assertEquals(1, h.starts); assertEquals(0, h.stops)
        h.resource.release("activity")
        assertEquals(1, h.stops)
    }
    @Test fun cancelledInitializationCannotReviveAStoppedReader() {
        val h = Harness()
        var calls = 0
        h.resource.acquire("service") { calls++ }
        h.resource.release("service")
        h.ready()
        assertEquals(0, calls); assertNull(h.resource.value); assertEquals(1, h.stops)
        h.resource.retain("activity")
        assertEquals(2, h.starts)
        h.completions.first()(Result.success("stale-engine"))
        assertNull(h.resource.value)
        h.ready(); assertEquals("engine-2", h.resource.value)
    }
    @Test fun stoppingPendingReaderDoesNotCancelForegroundWarmup() {
        val h = Harness()
        var calls = 0
        h.resource.retain("activity")
        h.resource.acquire("service") { calls++ }
        h.resource.release("service"); h.ready()
        assertEquals(0, calls); assertNotNull(h.resource.value); assertEquals(0, h.stops)
    }
    @Test fun failedInitializationClosesResourcesAndNextReadCanRetry() {
        val h = Harness()
        var failed = false
        h.resource.acquire("service") { failed = it.isFailure }
        h.completions.last()(Result.failure(IllegalStateException("Engine unavailable")))
        assertTrue(failed); assertEquals(1, h.stops); assertNull(h.resource.value)
        var succeeded = false
        h.resource.acquire("service") { succeeded = it.isSuccess }
        h.ready(); assertTrue(succeeded); assertEquals(2, h.starts)
    }
    @Test fun invalidatedEngineIsNeverReused() {
        val h = Harness()
        h.resource.retain("activity"); h.ready()
        h.resource.invalidate()
        var reading: PreparedResource.Acquisition<String>? = null
        h.resource.acquire("service") { reading = it.getOrThrow() }
        assertNull(reading)
        h.ready()
        assertFalse(reading!!.reused); assertEquals(2, h.starts)
    }
    @Test fun repeatedForegroundSignalsDoNotOpenDuplicateConnections() {
        val h = Harness()
        repeat(10) { h.resource.retain("activity") }
        assertEquals(1, h.starts)
        h.ready()
        repeat(10) { h.resource.retain("activity") }
        assertEquals(1, h.starts)
        h.resource.release("activity"); assertEquals(1, h.stops)
    }
    @Test fun synchronousFactoryFailureStillReleasesItsConnection() {
        var stops = 0
        val resource = PreparedResource<String>({ 0L }) { complete ->
            complete(Result.failure(IllegalStateException("No engine")))
            val cleanup: () -> Unit = { stops++ }
            cleanup
        }
        var failed = false
        resource.acquire("service") { failed = it.isFailure }
        assertTrue(failed); assertEquals(1, stops)
    }
}
