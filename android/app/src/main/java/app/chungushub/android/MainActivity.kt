package app.chungushub.android

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.CookieManager
import android.webkit.HttpAuthHandler
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    private lateinit var root: View
    private lateinit var setup: View
    private lateinit var addressInput: EditText
    private lateinit var status: TextView
    private lateinit var resume: Button
    private lateinit var progress: ProgressBar
    private lateinit var exports: DocumentExports
    private var browser: WebView? = null
    private var server: ServerAddress? = null
    private var chooserCallback: ValueCallback<Array<Uri>>? = null
    private var imeVisible = false
    private var backPending = false
    private var activityResumed = false
    private val clipboard = ClipboardTransfer { text ->
        check(activityResumed && hasWindowFocus()) { "Return to Chungus and try copying again." }
        val manager = getSystemService(ClipboardManager::class.java)
        manager.setPrimaryClip(ClipData.newPlainText("Chungus", text))
        check(manager.primaryClip?.getItemAt(0)?.text?.toString() == text) { "Android did not retain the copied text." }
    }
    private val preferences by lazy { getSharedPreferences("server", MODE_PRIVATE) }

    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = chooserCallback
        chooserCallback = null
        callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
    }
    private val saveFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        exports.destination(if (result.resultCode == RESULT_OK) result.data?.data else null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        setup = findViewById(R.id.setup)
        addressInput = findViewById(R.id.server_url)
        status = findViewById(R.id.setup_message)
        resume = findViewById(R.id.resume)
        progress = findViewById(R.id.progress)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
            show(WindowInsetsCompat.Type.systemBars())
        }
        // The native root owns system-bar/cutout/IME padding. Consume the insets so
        // WebView does not apply them again through its viewport and CSS safe areas.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
        exports = DocumentExports(contentResolver, { runOnUiThread(it) }, { name, mime ->
            saveFile.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE); type = mime; putExtra(Intent.EXTRA_TITLE, name)
            })
        }, { toast("File saved.") })
        addressInput.setText(preferences.getString("url", ""))
        findViewById<Button>(R.id.connect).setOnClickListener { connect() }
        resume.setOnClickListener { setup.visibility = View.GONE; hideKeyboard() }
        addressInput.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) { connect(); true } else false
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { goBack() }
        })
        if (intent.action != SETTINGS_ACTION && !preferences.getString("url", "").isNullOrBlank()) connect()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == SETTINGS_ACTION) showSetup()
    }

    private fun connect() {
        val selected = try { ServerAddress.parse(addressInput.text.toString()) }
        catch (_: Exception) { addressInput.error = "Enter a valid HTTPS address without credentials or query parameters."; return }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            status.setText(R.string.update_webview)
            return
        }
        hideKeyboard()
        clipboard.cancel()
        exports.cancel()
        chooserCallback?.onReceiveValue(null); chooserCallback = null
        browser?.let { (it.parent as FrameLayout).removeView(it); it.destroy() }
        server = selected
        preferences.edit().putString("url", selected.url).apply()
        addressInput.setText(selected.url)
        val view = createBrowser(selected)
        browser = view
        findViewById<FrameLayout>(R.id.web_container).addView(view,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setup.visibility = View.GONE
        status.text = ""
        view.loadUrl(selected.url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createBrowser(selected: ServerAddress): WebView {
        val view = object : WebView(this) {
            override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
                val connection = super.onCreateInputConnection(outAttrs)
                outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_EXTRACT_UI
                return connection
            }
        }
        view.setBackgroundColor(Color.rgb(16, 22, 25))
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            allowFileAccess = false
            allowContentAccess = true // Files selected by the user arrive as content:// URIs.
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            mediaPlaybackRequiresUserGesture = true
            userAgentString += " ChungusAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply { setAcceptCookie(true); setAcceptThirdPartyCookies(view, false) }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(view, "ChungusNative", setOf(selected.origin)) { _, message, origin, mainFrame, reply ->
            if (!mainFrame || !selected.trusts(origin.toString()) || browser !== view || !selected.trusts(view.url.orEmpty())) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            if (data.length > 100000) return@addWebMessageListener
            runCatching { receive(JSONObject(data), reply) }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(view, assets.open("client.js").bufferedReader().use { it.readText() }, setOf(selected.origin))
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (!request.isForMainFrame) return false
                if (selected.trusts(request.url.toString())) return false
                if (request.hasGesture()) openExternal(request.url)
                return true
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                clipboard.cancel()
                exports.cancel()
                progress.visibility = View.VISIBLE
            }
            override fun onPageFinished(view: WebView, url: String) {
                progress.visibility = View.GONE
                CookieManager.getInstance().flush()
                updatePageLifecycle(view)
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) showSetup("Could not connect. Check the address, your connection, and whether the server is running.")
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                showSetup("The HTTPS certificate could not be verified. Check the server domain and certificate.")
            }
            override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String) {
                if (!selected.trusts(view.url.orEmpty()) || !Uri.parse(selected.origin).host.equals(host, true)) { handler.cancel(); return }
                val fields = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 8, 32, 8) }
                val username = EditText(this@MainActivity).apply { hint = "Username"; isSingleLine = true }
                val password = EditText(this@MainActivity).apply { hint = "Password"; isSingleLine = true; inputType = 129 }
                fields.addView(username); fields.addView(password)
                AlertDialog.Builder(this@MainActivity).setTitle("Server sign-in").setMessage(selected.origin).setView(fields)
                    .setPositiveButton("Sign in") { _, _ -> handler.proceed(username.text.toString(), password.text.toString()) }
                    .setNegativeButton("Cancel") { _, _ -> handler.cancel() }.setOnCancelListener { handler.cancel() }.show()
            }
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                clipboard.cancel()
                exports.cancel()
                (view.parent as? FrameLayout)?.removeView(view)
                if (browser === view) browser = null
                view.destroy()
                showSetup("Android released the page from memory. Tap Connect to reopen your server.")
                return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) { progress.progress = newProgress }
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (!selected.trusts(view.url.orEmpty())) return false
                chooserCallback?.onReceiveValue(null)
                chooserCallback = callback
                val types = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }.map { type ->
                    if (type.startsWith('.')) android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.drop(1)) ?: "application/octet-stream" else type
                }.distinct()
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = types.singleOrNull() ?: "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                return try { chooseFile.launch(intent); true }
                catch (_: Exception) { chooserCallback = null; callback.onReceiveValue(null); true }
            }
            override fun onCreateWindow(view: WebView, dialog: Boolean, userGesture: Boolean, resultMsg: android.os.Message): Boolean {
                if (userGesture) view.hitTestResult.extra?.let { openExternal(Uri.parse(it)) }
                return false
            }
        }
        view.setDownloadListener { url, _, disposition, mime, _ ->
            if (selected.trusts(view.url.orEmpty())) {
                val filename = safeFilename(android.webkit.URLUtil.guessFileName(url, disposition, mime))
                view.evaluateJavascript("window.ChungusAndroidClient?.download(${JSONObject.quote(url)}, ${JSONObject.quote(filename)})", null)
            }
        }
        return view
    }

    private fun receive(message: JSONObject, proxy: JavaScriptReplyProxy) {
        val id = message.optString("id")
        val reply: (Boolean, String, String?) -> Unit = { ok, error, transfer ->
            val result = JSONObject().put("id", id).put("ok", ok)
            if (error.isNotEmpty()) result.put("error", error)
            if (transfer != null) result.put("transfer", transfer)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) runCatching { proxy.postMessage(result.toString()) }
        }
        when (val type = message.optString("type")) {
            "settings" -> { showSetup(); reply(true, "", null) }
            "notice" -> { toast(message.optString("message").take(180)); reply(true, "", null) }
            "clipboard.begin", "clipboard.chunk", "clipboard.end", "clipboard.abort" -> {
                try {
                    check(activityResumed && hasWindowFocus()) { "Return to Chungus and try copying again." }
                    val transfer = message.optString("transfer")
                    when (type) {
                        "clipboard.begin" -> {
                            val started = clipboard.begin(message.getInt("size"))
                            reply(true, "", started)
                            return
                        }
                        "clipboard.chunk" -> clipboard.append(transfer, message.getInt("offset"), message.getString("text"))
                        "clipboard.end" -> clipboard.finish(transfer)
                        "clipboard.abort" -> clipboard.abort(transfer)
                    }
                    reply(true, "", null)
                } catch (_: Exception) {
                    clipboard.abort(message.optString("transfer"))
                    reply(false, "Could not copy the text. Return to Chungus and try again.", null)
                }
            }
            "export.begin" -> exports.begin(message, reply)
            "export.chunk", "export.end", "export.abort" -> exports.handle(type, message, reply)
            else -> reply(false, "Unknown operation.", null)
        }
    }

    private fun showSetup(message: String = "") {
        setup.visibility = View.VISIBLE
        progress.visibility = View.GONE
        resume.visibility = if (browser != null) View.VISIBLE else View.GONE
        status.text = message
        addressInput.clearFocus()
    }

    private fun goBack() {
        if (imeVisible) { hideKeyboard(); return }
        if (setup.visibility == View.VISIBLE) {
            if (browser != null) setup.visibility = View.GONE else moveTaskToBack(true)
            return
        }
        val view = browser ?: run { showSetup(); return }
        if (backPending) return
        backPending = true
        view.evaluateJavascript("Boolean(window.ChungusAndroidClient?.back())") { handled ->
            backPending = false
            if (browser === view && handled != "true") moveTaskToBack(true)
        }
        view.postDelayed({ backPending = false }, 1000)
    }

    private fun hideKeyboard() { WindowInsetsControllerCompat(window, root).hide(WindowInsetsCompat.Type.ime()) }
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    private fun openExternal(uri: Uri) {
        if (uri.scheme !in setOf("https", "http", "mailto", "tel")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { toast("No app is available to open this link.") }
    }
    private fun updatePageLifecycle(view: WebView? = browser) {
        if (view == null || browser !== view || server?.trusts(view.url.orEmpty()) != true) return
        view.evaluateJavascript("window.ChungusAndroidClient?.setForeground?.($activityResumed)", null)
    }
    override fun onPause() {
        activityResumed = false
        clipboard.cancel()
        updatePageLifecycle()
        browser?.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }
    override fun onResume() {
        super.onResume()
        activityResumed = true
        browser?.onResume()
        updatePageLifecycle()
    }
    override fun onDestroy() {
        clipboard.cancel()
        chooserCallback?.onReceiveValue(null); chooserCallback = null
        exports.close()
        browser?.let { (it.parent as? FrameLayout)?.removeView(it); it.destroy() }; browser = null
        super.onDestroy()
    }
    companion object { private const val SETTINGS_ACTION = "app.chungushub.android.SETTINGS" }
}
