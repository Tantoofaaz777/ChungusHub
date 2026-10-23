package app.chungushub.android

import org.junit.Assert.*
import org.junit.Test

class SpeechRulesTest {
    private fun rule(id: String = "one", pattern: String = "OOC") = SpeechRule(id, pattern, false, false, true)
    @Test fun preservesOrderAndRegexVerbatim() {
        val rules = listOf(rule("two", "\\[[^\\]]*\\]"), rule("one"))
        assertEquals(rules, SpeechRule.checked(rules))
    }
    @Test fun rejectsDuplicateIdsAndExcessRules() {
        assertThrows(IllegalArgumentException::class.java) { SpeechRule.checked(listOf(rule(), rule())) }
        assertThrows(IllegalArgumentException::class.java) { SpeechRule.checked((0..30).map { rule(it.toString()) }) }
    }
    @Test fun rejectsEmptyAndOversizeRules() {
        listOf("", "  ", "x".repeat(1001)).forEach { pattern ->
            assertThrows(IllegalArgumentException::class.java) { SpeechRule.checked(listOf(rule(pattern = pattern))) }
        }
        assertThrows(IllegalArgumentException::class.java) { SpeechRule.checked(listOf(rule(id = "x".repeat(81)))) }
        assertEquals(emptyList<SpeechRule>(), SpeechRule.checked(emptyList()))
    }
}
