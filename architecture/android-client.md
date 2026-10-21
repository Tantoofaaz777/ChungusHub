# Android remote client

The optional Kotlin client under `android/` opens the same HTTPS server as desktop browsers.
It embeds no web build, database or Bun server. Existing HTTP/WebSocket sessions and server
sync remain authoritative. Android-specific changes are isolated from web packaging; see
[android/README.md](../android/README.md) for build, installation and device checks.

The shell uses an exact-origin, main-frame-only AndroidX WebKit message listener. A small
document-start script adapts existing anchor downloads to a native document picker and bounded
acknowledged chunks. `DocumentExports` owns IO on a worker; `ExportWriter` verifies byte offsets
and expected size. Remote HTML, file chooser content URIs and external browser links never gain
an unrestricted JavaScript interface. Changing servers destroys the previous WebView and transfer.

The frontend's optional `android-client.ts` adapter installs one back handler in Workspace.
Android first dismisses the IME; the web handler dispatches a tagged Escape through the existing
dialog/editor/settings owners. An unconsumed Escape peels the workspace panel, then returns
to Home, then permits Android to background its task. Tagged Escape never focuses the composer.
Desktop Escape keeps its existing behavior. Settings root adds the native configuration button
only while the Android adapter is present. No native bridge is required by normal browsers.

The APK and frontend can update separately, but the full back integration needs the matching
frontend deployed on the server. The shell includes a limited modal fallback for older builds.
No wake lock or background service is introduced: server generation already outlives a socket.

The native root applies system-bar, display-cutout and IME padding and returns consumed
insets. Descendant WebViews must not apply the same insets a second time through their
viewport/CSS safe-area values. System bars stay visible; native UI strings are English.

Validation: Kotlin tests cover HTTPS origin boundaries, safe names and binary export ordering/
size. Bun tests execute the actual injected script against blob/HTTP downloads, cancellation,
IO failure and frame boundaries. A browser integration check exercises the real Svelte dialogs,
settings drill-down and Home with the injected adapter. Android lint and APK assembly run with
Gradle. Native keyboard/SAF behavior still needs a real device or emulator to verify end to end.
