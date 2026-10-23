package app.chungushub.android

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.webkit.CookieManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.util.concurrent.Executors
import javax.crypto.Cipher

/** Native gate, independent of the VPS frontend. Passwords never pass through JavaScript. */
class AppLock(
    private val activity: FragmentActivity,
    root: FrameLayout,
    private val settings: LinearLayout,
    private val accessChanged: () -> Unit,
    private val unlocked: () -> Unit,
    private val changeServer: () -> Unit
) {
    private enum class Configuration { NONE, ENABLE, BIOMETRICS }
    private val accent = Color.rgb(126, 201, 187)
    private val muted = Color.rgb(170, 185, 182)
    private val worker = Executors.newSingleThreadExecutor()
    private val policy = LockState()
    private var address: ServerAddress? = null
    private var vault: CredentialVault? = null
    private var foreground = false
    private var closed = false
    private var generation = 0
    private var busy = false
    private var configuration = Configuration.NONE
    private var setupVisible = false
    private var updating = false
    private var biometricPrompt: BiometricPrompt? = null
    private data class Deferred(val action: () -> Unit, val discard: () -> Unit)
    private val deferred = mutableListOf<Deferred>()
    private val gate = ScrollView(activity).apply {
        setBackgroundColor(Color.rgb(16, 22, 25)); isFillViewport = true
        visibility = View.GONE
    }
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; gravity = android.view.Gravity.CENTER_VERTICAL
        setPadding(dp(28), dp(28), dp(28), dp(28))
    }
    private val heading = text("Welcome back", 28, true)
    private val host = text("", 14)
    private val password = EditText(activity).apply {
        hint = "Server password"; isSingleLine = true; inputType = 129
        imeOptions = EditorInfo.IME_ACTION_GO or EditorInfo.IME_FLAG_NO_EXTRACT_UI
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        setTextColor(Color.WHITE); setHintTextColor(muted); minHeight = dp(56)
    }
    private val feedback = text("", 14).apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
    private val remember = CheckBox(activity).apply {
        text = "Enable biometric unlock on this device"; setTextColor(muted); minHeight = dp(48)
    }
    private val submit = button("Unlock") { passwordLogin() }
    private val biometric = button("Unlock with biometrics") { biometricLogin() }
    private val cancel = button("Cancel") { cancelConfiguration() }
    private val serverButton = button("Change server") {
        setupVisible = true; render(); changeServer()
    }
    private val requireUnlock = Switch(activity).apply { text = "Require unlock"; setTextColor(Color.WHITE); minHeight = dp(48) }
    private val useBiometrics = Switch(activity).apply { text = "Biometric unlock"; setTextColor(Color.WHITE); minHeight = dp(48) }
    private val delay = button("Lock after leaving the app: 1 minute") {
        AlertDialog.Builder(activity).setTitle("Lock after leaving the app")
            .setSingleChoiceItems(LockState.labels.toTypedArray(), LockState.delays.indexOf(policy.delayMillis)) { dialog, index ->
                policy.delayMillis = LockState.delays[index]
                vault?.preferences?.edit()?.putLong("delay", policy.delayMillis)?.apply()
                updateSettings(); dialog.dismiss()
            }.setNegativeButton("Cancel", null).show()
    }

    val enabled: Boolean get() = vault?.preferences?.getBoolean("enabled", false) == true
    val locked: Boolean get() = (enabled || configuration != Configuration.NONE) && policy.locked

    init {
        gate.addView(content, FrameLayout.LayoutParams(-1, -2))
        content.addView(ImageView(activity).apply {
            setImageResource(R.mipmap.chungus); contentDescription = "Chungus"
        }, LinearLayout.LayoutParams(dp(72), dp(72)).apply { bottomMargin = dp(24) })
        listOf(heading, host, text("Enter your server password or use biometrics to continue.", 16), password,
            feedback, remember, submit, biometric, cancel, serverButton).forEach { add(content, it) }
        root.addView(gate, FrameLayout.LayoutParams(-1, -1))
        add(settings, text("App lock", 20, true))
        add(settings, text("Protect this Android app with your server password. Requires a password configured on your server.", 14))
        add(settings, requireUnlock)
        add(settings, useBiometrics)
        add(settings, delay)
        add(settings, text("A fresh app launch always requires unlock. Biometrics encrypt your server password on this device and need a strong fingerprint or face unlock.", 13))
        requireUnlock.setOnCheckedChangeListener { _, checked ->
            if (!updating) {
                if (checked) beginConfiguration(Configuration.ENABLE)
                else {
                    vault?.preferences?.edit()?.putBoolean("enabled", false)?.apply()
                    runCatching { vault?.clear() }
                    policy.unlock(); render()
                }
                updateSettings()
            }
        }
        useBiometrics.setOnCheckedChangeListener { _, checked ->
            if (!updating) {
                if (checked) beginConfiguration(Configuration.BIOMETRICS)
                else { runCatching { vault?.clear() }; updateSettings() }
            }
        }
        password.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) { passwordLogin(); true } else false
        }
        updateSettings()
    }

    fun attach(server: ServerAddress) {
        generation++; biometricPrompt?.cancelAuthentication(); biometricPrompt = null
        discardDeferred(); busy = false; password.text.clear(); configuration = Configuration.NONE
        setupVisible = false; address = server; vault = CredentialVault(activity, server.origin)
        policy.delayMillis = vault!!.preferences.getLong("delay", 60_000).takeIf { it in LockState.delays } ?: 60_000
        if (enabled) policy.lock() else policy.unlock()
        feedback.text = ""; remember.isChecked = false
        render()
    }

    fun settingsOpened() { setupVisible = true; render() }
    fun settingsClosed() { setupVisible = false; render() }
    fun sessionExpired() {
        if (!enabled || locked) return
        policy.lock(); setupVisible = false; render()
    }

    private fun beginConfiguration(mode: Configuration) {
        if (!foreground || locked || address == null) { updateSettings(); return }
        configuration = mode; policy.lock(); setupVisible = false
        feedback.text = ""; remember.isChecked = mode == Configuration.BIOMETRICS
        render()
    }

    private fun cancelConfiguration() {
        if (configuration == Configuration.NONE || busy) return
        generation++; biometricPrompt?.cancelAuthentication(); biometricPrompt = null
        configuration = Configuration.NONE; password.text.clear(); setupVisible = true
        policy.unlock(); render(); releaseDeferred()
    }

    private fun canUseBiometrics() = BiometricManager.from(activity)
        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    private fun updateSettings() {
        updating = true
        settings.visibility = if (address != null && !locked) View.VISIBLE else View.GONE
        requireUnlock.isChecked = enabled
        useBiometrics.isChecked = vault?.hasCredential() == true
        useBiometrics.isEnabled = enabled && (useBiometrics.isChecked || canUseBiometrics())
        delay.isEnabled = enabled
        delay.text = "Lock after leaving the app: ${LockState.labels[LockState.delays.indexOf(policy.delayMillis)]}"
        updating = false
    }

    private fun render() {
        val protected = enabled || configuration != Configuration.NONE
        val cover = protected && (!foreground || (locked && !setupVisible))
        gate.visibility = if (cover) View.VISIBLE else View.GONE
        // Cover the task preview before leaving. Foreground screenshots remain available after unlock.
        if (protected && (!foreground || locked)) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        heading.text = when (configuration) {
            Configuration.ENABLE -> "Protect your app"
            Configuration.BIOMETRICS -> "Enable biometrics"
            else -> "Welcome back"
        }
        host.text = address?.origin.orEmpty()
        submit.isEnabled = !busy && foreground
        submit.text = if (busy) "Unlocking…" else "Unlock"
        password.isEnabled = !busy
        val available = canUseBiometrics()
        remember.visibility = if (!vaultHasCredential() && available) View.VISIBLE else View.GONE
        remember.isEnabled = !busy
        biometric.visibility = if (configuration == Configuration.NONE && vaultHasCredential()) View.VISIBLE else View.GONE
        biometric.isEnabled = !busy && foreground && available
        cancel.visibility = if (configuration != Configuration.NONE) View.VISIBLE else View.GONE
        cancel.isEnabled = !busy
        serverButton.visibility = if (configuration == Configuration.NONE) View.VISIBLE else View.GONE
        serverButton.isEnabled = !busy
        updateSettings(); accessChanged()
    }

    private fun vaultHasCredential() = vault?.hasCredential() == true
    private fun valid(epoch: Int) = !closed && foreground && epoch == generation

    private fun passwordLogin() {
        if (!foreground || busy || !locked) return
        val value = password.text.toString()
        if (value.isEmpty()) { feedback.text = "Enter your server password."; return }
        password.text.clear()
        val enroll = remember.isChecked && canUseBiometrics() && !vaultHasCredential()
        authenticate(value, false) { if (enroll) enrollBiometrics(value) else finishUnlock() }
    }

    private fun authenticate(value: String, fromBiometrics: Boolean, success: () -> Unit) {
        val selected = address ?: return
        val epoch = ++generation
        busy = true; feedback.text = ""; render()
        worker.execute {
            val result = runCatching { ServerLogin.authenticate(selected, value) }
            activity.runOnUiThread {
                if (!valid(epoch)) return@runOnUiThread
                result.fold({ cookie ->
                    CookieManager.getInstance().setCookie(selected.origin, cookie) { accepted ->
                        if (!valid(epoch)) return@setCookie
                        if (accepted) {
                            CookieManager.getInstance().flush()
                            if (configuration == Configuration.ENABLE) vault?.preferences?.edit()?.putBoolean("enabled", true)?.apply()
                            success()
                        } else fail("Android could not save the server session. Please try again.")
                    }
                }, { error ->
                    if (fromBiometrics && error is LoginRejected && error.status == 401) {
                        runCatching { vault?.clear() }
                        fail("Your server password changed. Enter it again to restore biometric unlock.")
                    } else fail(if (error is LoginRejected) error.message.orEmpty()
                        else "Could not reach the server securely. Check your connection and HTTPS certificate.")
                })
            }
        }
    }

    private fun biometricLogin() {
        if (!foreground || busy || !locked || !canUseBiometrics()) return
        val saved = vault ?: return
        val cipher = try { saved.decryption() } catch (_: Exception) {
            runCatching { saved.clear() }
            fail("Biometric unlock needs to be set up again. Enter your server password."); return
        }
        prompt(cipher, false, { authorized ->
            val value = try { saved.read(authorized) } catch (_: Exception) {
                runCatching { saved.clear() }; fail("Could not unlock the saved password. Enter your server password."); return@prompt
            }
            authenticate(value, true) { finishUnlock() }
        }, { fail("Use your server password, or try biometrics again.") })
    }

    private fun enrollBiometrics(value: String) {
        val saved = vault ?: return
        val cipher = try { saved.encryption() } catch (_: Exception) {
            finishUnlock(); android.widget.Toast.makeText(activity, "Could not enable biometric unlock.", android.widget.Toast.LENGTH_LONG).show(); return
        }
        prompt(cipher, true, { authorized ->
            if (runCatching { saved.save(authorized, value) }.isFailure) {
                runCatching { saved.clear() }
                android.widget.Toast.makeText(activity, "Could not save biometric unlock. Your password still works.", android.widget.Toast.LENGTH_LONG).show()
            }
            finishUnlock()
        }, { runCatching { saved.clear() }; finishUnlock() })
    }

    private fun prompt(cipher: Cipher, enrolling: Boolean, success: (Cipher) -> Unit, cancel: () -> Unit) {
        val epoch = ++generation
        busy = true; render()
        biometricPrompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                if (!valid(epoch)) return
                biometricPrompt = null
                result.cryptoObject?.cipher?.let(success) ?: fail("Biometric authorization was incomplete. Use your server password.")
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                if (!valid(epoch)) return
                biometricPrompt = null; cancel()
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(if (enrolling) "Enable biometric unlock" else "Unlock Chungus")
            .setSubtitle(address?.origin.orEmpty())
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(if (enrolling) "Not now" else "Use server password")
            .build()
        try { biometricPrompt!!.authenticate(info, BiometricPrompt.CryptoObject(cipher)) }
        catch (_: Exception) { biometricPrompt = null; cancel() }
    }

    private fun finishUnlock() {
        busy = false; configuration = Configuration.NONE; policy.unlock()
        password.text.clear(); feedback.text = ""; remember.isChecked = false
        render(); unlocked(); releaseDeferred()
    }
    private fun releaseDeferred() {
        if (locked || !foreground) return
        val pending = deferred.toList(); deferred.clear(); pending.forEach { it.action() }
    }
    private fun fail(message: String) { busy = false; feedback.text = message; render() }

    fun whenUnlocked(discard: () -> Unit = {}, action: () -> Unit) {
        if (!locked && foreground) action() else deferred.add(Deferred(action, discard))
    }
    private fun discardDeferred() {
        val pending = deferred.toList(); deferred.clear(); pending.forEach { runCatching { it.discard() } }
    }
    fun back(): Boolean {
        if (!locked) return false
        if (configuration != Configuration.NONE && !busy) cancelConfiguration() else activity.moveTaskToBack(true)
        return true
    }
    fun pause() {
        // An interrupted settings prompt returns to the already-authorized settings screen.
        // Its background time still counts, so Cancel can never bypass an expired lock.
        if (configuration != Configuration.NONE) {
            configuration = Configuration.NONE; setupVisible = true; policy.unlock()
        }
        foreground = false; policy.background(SystemClock.elapsedRealtime())
        generation++; biometricPrompt?.cancelAuthentication(); biometricPrompt = null
        busy = false; password.text.clear(); render()
    }
    fun resume() {
        foreground = true; policy.foreground(SystemClock.elapsedRealtime())
        if (locked) setupVisible = false
        render(); releaseDeferred()
    }
    fun close() {
        closed = true; generation++; biometricPrompt?.cancelAuthentication(); biometricPrompt = null
        discardDeferred(); worker.shutdownNow()
    }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Int, bold: Boolean = false) = TextView(activity).apply {
        text = value; textSize = size.toFloat(); setTextColor(if (bold) Color.WHITE else muted)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun button(value: String, action: () -> Unit) = Button(activity).apply {
        text = value; isAllCaps = false; minHeight = dp(50); setTextColor(accent)
        background = GradientDrawable().apply {
            cornerRadius = dp(10).toFloat(); setColor(Color.rgb(25, 35, 37)); setStroke(dp(1), Color.rgb(53, 77, 73))
        }
        setOnClickListener { action() }
    }
    private fun add(parent: LinearLayout, view: View) {
        parent.addView(view, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
    }
}
