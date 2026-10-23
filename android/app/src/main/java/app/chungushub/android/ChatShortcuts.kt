package app.chungushub.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Bundle
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

data class ChatShortcutTarget(val origin: String, val chatId: String, val title: String) {
    init {
        require(ServerAddress.parse(origin).origin == origin)
        require(chatId.isNotBlank() && chatId.length <= 200 && chatId.none { it.isISOControl() }) { "Invalid chat ID." }
        require(title.isNotBlank() && title.length <= 120 && title.none { it.isISOControl() }) { "Invalid chat title." }
    }
    val shortcutId: String get() = "chat-" + MessageDigest.getInstance("SHA-256")
        .digest((origin + "\u0000" + chatId).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

data class ChatShortcutLaunch(val id: String, val target: ChatShortcutTarget)

/** Launcher intents carry a local record ID, never a URL to trust or a session credential. */
class ChatShortcuts(private val activity: Activity) {
    private val preferences = activity.getSharedPreferences("chat-shortcuts", Context.MODE_PRIVATE)
    private val manager get() = activity.getSystemService(ShortcutManager::class.java)
    var pending: ChatShortcutLaunch? = null
        private set

    fun pin(server: ServerAddress, chatId: String, title: String) {
        check(manager.isRequestPinShortcutSupported) { "Your launcher does not support pinned shortcuts." }
        val target = ChatShortcutTarget(server.origin, chatId, title.trim().replace(Regex("[\\p{Cntrl}]"), " ").take(120).ifBlank { "Chat" })
        val shortcut = ShortcutInfo.Builder(activity, target.shortcutId)
            .setShortLabel(target.title.take(40)).setLongLabel(target.title)
            .setIcon(Icon.createWithResource(activity, R.mipmap.chungus))
            .setIntent(Intent(activity, MainActivity::class.java).apply {
                action = OPEN_CHAT
                data = Uri.parse("chungus://chat/${target.shortcutId}")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }).build()
        check(preferences.edit().putString(target.shortcutId, JSONObject()
            .put("origin", target.origin).put("chatId", target.chatId).put("title", target.title).toString()).commit()) {
            "Could not save the chat shortcut."
        }
        // Updating an existing pinned ID also refreshes its label after a chat rename.
        manager.updateShortcuts(listOf(shortcut))
        check(manager.requestPinShortcut(shortcut, null)) { "Your launcher could not add the shortcut. Try again from Chungus." }
    }

    private fun record(id: String, server: ServerAddress): ChatShortcutTarget {
        require(id.matches(Regex("chat-[a-f0-9]{64}"))) { "Invalid chat shortcut." }
        val saved = JSONObject(preferences.getString(id, null) ?: error("This chat shortcut is no longer available."))
        val target = ChatShortcutTarget(saved.getString("origin"), saved.getString("chatId"), saved.getString("title"))
        require(target.shortcutId == id) { "Invalid chat shortcut." }
        require(target.origin == server.origin) { "This shortcut belongs to another server. Connect to that server first." }
        return target
    }

    fun capture(intent: Intent, server: ServerAddress) {
        if (intent.action != OPEN_CHAT) return
        val uri = intent.data ?: error("Invalid chat shortcut.")
        require(uri.scheme == "chungus" && uri.host == "chat" && uri.query == null && uri.fragment == null && uri.userInfo == null)
        pending = ChatShortcutLaunch(UUID.randomUUID().toString(), record(uri.path.orEmpty().removePrefix("/"), server))
    }

    fun save(state: Bundle) {
        state.putBoolean("chatShortcutState", true)
        pending?.let { state.putString("chatShortcutRecord", it.target.shortcutId); state.putString("chatShortcutRequest", it.id) }
    }

    fun restore(state: Bundle, server: ServerAddress) {
        val id = state.getString("chatShortcutRecord") ?: return
        pending = ChatShortcutLaunch(state.getString("chatShortcutRequest") ?: UUID.randomUUID().toString(), record(id, server))
    }

    fun serverChanged(server: ServerAddress) { if (pending?.target?.origin != server.origin) pending = null }
    fun acknowledge(id: String) { if (pending?.id == id) pending = null }
    fun clearPending() { pending = null }
    fun payload(server: ServerAddress): JSONObject? = pending?.takeIf { it.target.origin == server.origin }
        ?.let { JSONObject().put("id", it.id).put("chatId", it.target.chatId) }

    companion object { const val OPEN_CHAT = "app.chungushub.android.OPEN_CHAT" }
}
