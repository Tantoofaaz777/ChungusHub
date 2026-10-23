package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class LockStateTest {
    @Test fun automaticBiometricsWaitsForResumeAndWindowFocus() {
        val state = LockState()
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.foreground(0)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = false))
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

    @Test fun unavailableBiometricsOrBusyLoginDoesNotConsumeAnAutomaticAttempt() {
        val state = LockState()
        state.foreground(0)
        assertFalse(state.takeBiometricAttempt(eligible = false, windowFocused = true))
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

    @Test fun cancelledOrFailedBiometricsDoesNotReopenAfterFocusOrLifecycleChanges() {
        val state = LockState(0)
        state.foreground(0)
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        // Cancel or a server login failure keeps the same lock and its password fallback.
        assertTrue(state.showUnlock)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = false))
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.pause(); state.foreground(1)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.background(2); state.foreground(3)
        assertTrue(state.showUnlock)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

    @Test fun manualPasswordOrBiometricRetrySuppressesAQueuedAutomaticPrompt() {
        val state = LockState()
        state.foreground(0)
        state.suppressAutomaticBiometrics()
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        assertTrue(state.showUnlock)
    }

    @Test fun successfulUnlockRearmsBiometricsForTheNextExpiredLockOnly() {
        val state = LockState(30_000)
        state.foreground(0)
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.unlock()
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.background(100)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.foreground(30_099)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.background(31_000); state.foreground(61_000)
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

    @Test fun sessionExpiryCanPromptInTheForegroundButRepeatedLockDoesNotRearmIt() {
        val state = LockState()
        state.foreground(0); state.unlock(); state.lock()
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.lock()
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

    @Test fun shortcutConfirmationDoesNotTriggerBiometricsOrRearmACancelledPrompt() {
        val state = LockState(0)
        state.foreground(0); state.unlock()
        state.pause()
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.foreground(100)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.background(200); state.foreground(201)
        assertTrue(state.takeBiometricAttempt(eligible = true, windowFocused = true))
        state.pause(); state.foreground(202)
        assertFalse(state.takeBiometricAttempt(eligible = true, windowFocused = true))
    }

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
