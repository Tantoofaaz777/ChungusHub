package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class LockStateTest {
    @Test fun coldLaunchShowsTheFormOnlyWhenTheActivityResumes() {
        val state = LockState()
        assertTrue(state.locked)
        assertFalse(state.showUnlock)
        state.foreground(0)
        assertTrue(state.showUnlock)
        state.pause()
        assertTrue(state.locked)
        assertFalse(state.showUnlock)
    }

    @Test fun homeExitDoesNotFlashTheUnlockFormAndShortReturnStaysUnlocked() {
        val state = LockState()
        state.foreground(0); state.unlock()
        state.pause()
        assertFalse(state.showUnlock)
        state.background(100)
        assertFalse(state.showUnlock)
        state.foreground(1_000)
        assertFalse(state.locked)
        assertFalse(state.showUnlock)
    }

    @Test fun shortcutConfirmationWithoutStoppingDoesNotStartTheTimeoutEvenWithImmediateLock() {
        val state = LockState(0)
        state.foreground(0); state.unlock()
        state.pause() // Android's translucent pin-shortcut confirmation covers the activity.
        assertFalse(state.showUnlock)
        state.foreground(300_000)
        assertFalse(state.locked)
        assertFalse(state.showUnlock)
    }

    @Test fun goingHomeFromASystemDialogStillArmsTheLock() {
        val state = LockState(0)
        state.foreground(0); state.unlock(); state.pause()
        state.background(100) // Home fully hides both the dialog and Chungus.
        assertFalse(state.showUnlock)
        state.foreground(101)
        assertTrue(state.locked)
        assertTrue(state.showUnlock)
    }

    @Test fun expiredScreenOffPeriodShowsTheFormOnReturnOnly() {
        val state = LockState(30_000)
        state.foreground(0); state.unlock(); state.pause(); state.background(1_000)
        assertFalse(state.showUnlock)
        state.foreground(31_000)
        assertTrue(state.showUnlock)
        state.pause()
        assertFalse(state.showUnlock)
        state.foreground(31_001)
        assertTrue(state.showUnlock)
    }

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
