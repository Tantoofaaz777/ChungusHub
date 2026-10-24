package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class SpeechOptionsTest {
    @Test fun selectedVoiceRetainsItsEngineAndRoundsTheRate() {
        assertEquals(SpeechOptions("google", "en-us-voice", 1.25f), SpeechOptions.checked("google", "en-us-voice", 1.249f))
    }
    @Test fun defaultVoiceClearsTheEngineBinding() {
        assertEquals(SpeechOptions(rate = 1.5f), SpeechOptions.checked("old-engine", "  ", 1.5f))
    }
    @Test fun invalidRatesCannotReachTheSynthesisEngine() {
        for (rate in listOf(Float.NaN, Float.POSITIVE_INFINITY, Float.NEGATIVE_INFINITY, 0f, 0.49f, 2.01f)) {
            assertThrows(IllegalArgumentException::class.java) { SpeechOptions.checked("", "", rate) }
        }
        assertEquals(0.5f, SpeechOptions.checked("", "", 0.5f).rate)
        assertEquals(2f, SpeechOptions.checked("", "", 2f).rate)
    }
    @Test fun oversizedEngineAndVoiceIdentifiersAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { SpeechOptions.checked("x".repeat(513), "voice", 1f) }
        assertThrows(IllegalArgumentException::class.java) { SpeechOptions.checked("engine", "x".repeat(513), 1f) }
    }
    @Test fun legacyChoicesDefaultToStandardAudioFocus() {
        assertFalse(SpeechOptions().mixAudio)
        assertFalse(SpeechOptions.checked("google", "voice", 1f).mixAudio)
    }
    @Test fun mixingSurvivesRateRoundingAndDefaultVoiceSelection() {
        val selected = SpeechOptions.checked("google", "voice", 1.249f, mixAudio = true)
        assertTrue(selected.mixAudio); assertEquals(1.25f, selected.rate)
        val defaults = SpeechOptions.checked("old-engine", "", 1f, mixAudio = true)
        assertTrue(defaults.mixAudio); assertEquals("", defaults.engine)
        assertFalse(SpeechOptions.checked("google", "voice", 1f, mixAudio = false).mixAudio)
    }
}
