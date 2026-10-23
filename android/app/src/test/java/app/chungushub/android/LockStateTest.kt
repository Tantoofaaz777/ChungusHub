package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class LockStateTest {
    @Test fun freshProcessAlwaysStartsLocked() {
        assertTrue(LockState(900_000).locked)
        val state = LockState(); state.unlock()
        assertFalse(state.locked)
        assertTrue(LockState().locked)
    }

    @Test fun briefAppSwitchPreservesUnlockAndExactDeadlineLocks() {
        val state = LockState()
        state.unlock(); state.background(10_000); state.foreground(69_999)
        assertFalse(state.locked)
        state.background(70_000); state.foreground(130_000)
        assertTrue(state.locked)
    }

    @Test fun repeatedPauseCannotExtendTheGracePeriod() {
        val state = LockState(30_000)
        state.unlock(); state.background(100); state.background(20_000); state.foreground(30_100)
        assertTrue(state.locked)
    }

    @Test fun immediateSettingLocksOnEveryReturn() {
        val state = LockState(0)
        state.unlock(); state.background(100); state.foreground(100)
        assertTrue(state.locked)
    }

    @Test fun normalForegroundTimeDoesNotLockAnActiveUser() {
        val state = LockState()
        state.unlock(); state.foreground(5_000_000)
        assertFalse(state.locked)
    }

    @Test fun backwardsMonotonicClockFailsClosed() {
        val state = LockState()
        state.unlock(); state.background(100); state.foreground(99)
        assertTrue(state.locked)
    }

    @Test fun backgroundDoesNotUnlockAnAlreadyLockedApp() {
        val state = LockState()
        state.background(100); state.foreground(101)
        assertTrue(state.locked)
    }
}
