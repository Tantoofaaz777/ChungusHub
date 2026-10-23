package app.chungushub.android

import java.text.BreakIterator
import java.util.Locale

/** Bounded synthesis units. Long sentences split at whitespace without losing Unicode. */
object SpeechText {
    const val MAX_TEXT = 80000

    fun sentences(text: String, maxLength: Int = 3000, locale: Locale = Locale.getDefault()): List<String> {
        require(text.isNotBlank() && text.length <= MAX_TEXT) { "The message is empty or too long to read." }
        require(maxLength >= 2)
        val iterator = BreakIterator.getSentenceInstance(locale)
        iterator.setText(text)
        val result = mutableListOf<String>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            var part = text.substring(start, end).trim()
            while (part.length > maxLength) {
                var cut = part.lastIndexOf(' ', maxLength).takeIf { it > maxLength / 2 } ?: maxLength
                if (Character.isHighSurrogate(part[cut - 1]) && Character.isLowSurrogate(part[cut])) cut--
                result.add(part.substring(0, cut).trim())
                part = part.substring(cut).trimStart()
            }
            if (part.isNotEmpty()) result.add(part)
            start = end
            end = iterator.next()
        }
        require(result.isNotEmpty()) { "There is no text to read." }
        return result
    }
}
