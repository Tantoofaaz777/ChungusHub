package app.chungushub.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Regex execution belongs to a disposable Web worker, never the Android main thread. */
data class SpeechRule(val id: String, val pattern: String, val regex: Boolean, val caseSensitive: Boolean, val enabled: Boolean, val name: String = "") {
    companion object {
        fun checked(rules: List<SpeechRule>): List<SpeechRule> {
            require(rules.size <= 30) { "Use at most 30 speech rules." }
            require(rules.map { it.id }.toSet().size == rules.size) { "Speech rule IDs must be unique." }
            rules.forEach {
                require(it.id.isNotBlank() && it.id.length <= 80) { "Invalid speech rule ID." }
                require(it.name.length <= 120) { "Speech rule names must have at most 120 characters." }
                require(it.pattern.isNotBlank() && it.pattern.length <= 1000) { "Each speech rule needs 1 to 1,000 characters." }
            }
            return rules
        }
    }
}

object SpeechRules {
    private fun store(context: Context) = context.getSharedPreferences("read-aloud", Context.MODE_PRIVATE)
    private fun parse(array: JSONArray): List<SpeechRule> {
        require(array.length() <= 30) { "Use at most 30 speech rules." }
        return SpeechRule.checked((0 until array.length()).map { index ->
            val rule = array.getJSONObject(index)
            require(!rule.has("name") || rule.get("name") is String) { "Invalid speech rule name." }
            SpeechRule(rule.getString("id"), rule.getString("pattern"), rule.getBoolean("regex"), rule.getBoolean("caseSensitive"), rule.getBoolean("enabled"), rule.optString("name", ""))
        })
    }
    fun load(context: Context): JSONArray {
        val array = JSONArray(store(context).getString("rules", "[]"))
        parse(array) // Fail visibly instead of silently reading blacklisted text if data is damaged.
        return array
    }
    fun save(context: Context, array: JSONArray) {
        val clean = JSONArray().apply { parse(array).forEach { rule -> put(JSONObject()
            .put("id", rule.id).put("name", rule.name).put("pattern", rule.pattern).put("regex", rule.regex)
            .put("caseSensitive", rule.caseSensitive).put("enabled", rule.enabled)) } }
        store(context).edit().putString("rules", clean.toString()).apply()
    }
}
