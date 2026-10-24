package app.chungushub.android

import java.text.BreakIterator
import java.util.Locale

/** Bounded synthesis units. Long sentences split at whitespace without losing Unicode. */
object SpeechText {
    const val MAX_TEXT = 80000
    data class Part(val text: String, val start: Int, val end: Int)

    fun sentences(text: String, maxLength: Int = 3000, locale: Locale = Locale.getDefault()): List<String> =
        parts(text, maxLength, locale).map { it.text }

    fun parts(text: String, maxLength: Int = 3000, locale: Locale = Locale.getDefault()): List<Part> {
        require(text.isNotBlank() && text.length <= MAX_TEXT) { "The message is empty or too long to read." }
        require(maxLength >= 2)
        val iterator = BreakIterator.getSentenceInstance(locale)
        iterator.setText(text)
        val result = mutableListOf<Part>()
        var start = iterator.first()
        var end = iterator.next()
        while (end != BreakIterator.DONE) {
            val raw = text.substring(start, end)
            var offset = start + raw.length - raw.trimStart().length
            var part = raw.trim()
            while (part.length > maxLength) {
                var cut = part.lastIndexOf(' ', maxLength).takeIf { it > maxLength / 2 } ?: maxLength
                if (Character.isHighSurrogate(part[cut - 1]) && Character.isLowSurrogate(part[cut])) cut--
                val chunk = part.substring(0, cut).trim()
                result.add(Part(chunk, offset, offset + chunk.length))
                val tail = part.substring(cut)
                part = tail.trimStart()
                offset += cut + tail.length - part.length
            }
            if (part.isNotEmpty()) result.add(Part(part, offset, offset + part.length))
            start = end
            end = iterator.next()
        }
        require(result.isNotEmpty()) { "There is no text to read." }
        return result
    }
}
