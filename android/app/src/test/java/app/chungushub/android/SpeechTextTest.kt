package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test
import java.util.Locale

class SpeechTextTest {
    @Test fun splitsSentencesAndKeepsDialoguePunctuation() {
        assertEquals(listOf("She nodded.", "\"Come here!\"", "He followed."),
            SpeechText.sentences("She nodded. \"Come here!\" He followed.", locale = Locale.US))
    }

    @Test fun blankAndOversizedMessagesAreRejected() {
        for (text in listOf(" \n\t", "x".repeat(SpeechText.MAX_TEXT + 1))) {
            assertThrows(IllegalArgumentException::class.java) { SpeechText.sentences(text) }
        }
    }

    @Test fun longUnpunctuatedMessagesAreBoundedWithoutDroppingWords() {
        val original = (1..2000).joinToString(" ") { "word$it" }
        val sentences = SpeechText.sentences(original, 200)
        assertTrue(sentences.all { it.length <= 200 })
        assertEquals(original, sentences.joinToString(" "))
    }

    @Test fun longUnspacedUnicodeNeverSplitsASurrogatePair() {
        val original = "🌙".repeat(51)
        val sentences = SpeechText.sentences(original, 9)
        assertTrue(sentences.all { it.length <= 9 && !Character.isHighSurrogate(it.last()) && !Character.isLowSurrogate(it.first()) })
        assertEquals(original, sentences.joinToString(""))
    }

    @Test fun lineBreaksAndMultilingualTextRemainReadable() {
        val sentences = SpeechText.sentences("Olá, mundo!\n\nTudo bem?\n\n終わり。", locale = Locale.forLanguageTag("pt-BR"))
        assertEquals("Olá, mundo! Tudo bem? 終わり。", sentences.joinToString(" "))
        assertTrue(sentences.none { it.isBlank() })
    }
}
