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
Server generation already outlives a socket and does not need a wake lock or background service.
The optional read-aloud player below owns its own media service only while reading.

Since APK 0.1.3, Activity pause/resume (and page-finish initialization) updates the adapter's
`foreground` getter through `setForeground`. Changes emit `chungus-android-lifecycle` to the
page, independently of WebView's visibility-event timing. The transport combines this with
document visibility and pageshow: liveness/retry timers stop in the background, with no
intentional socket close or generation cancellation. Returning sends an immediate fresh
probe on an open socket or reconnects a closed socket. Old queued callbacks and timeouts
delayed by a frozen renderer cannot carry stale silence strikes into the resumed page.
Older APKs and normal browsers use document visibility. Android can still suspend networking.

## Read aloud (APK 0.1.8)

Message actions expose Read aloud only when all native speech capabilities are available.
The frontend extracts plain story text from the original message after identity macro
resolution, independently of display-scope regex and its rendered widgets. Markdown and
HTML formatting are stripped; comments, reasoning, toolbar content, images and link destinations
are not sent. Speech text is bounded to 80,000 UTF-16 characters and the fully escaped bridge request
stays below its existing 100,000-character limit. No speech state or audio is stored on the VPS.

`ReadAloudService` is a non-exported foreground `mediaPlayback` service with a platform
`MediaSession`, media notification and explicit immutable transport PendingIntents targeting
a non-exported receiver. It uses the device's default TTS engine and selected voice/rate to synthesize bounded
sentences to private temporary WAV files. `MediaPlayer` plays them, preserving the exact audio
position on pause. Previous/next navigate sentences (very long sentences use bounded fragments).
Only the current sentence and one ahead are retained; stopped or replaced sessions discard
their files. Random synthesis IDs reject late callbacks from cancelled work. Initialization
and synthesis have timeouts; a paused session expires after ten minutes. Process death does
not automatically resume private message audio.

Audio focus loss and headphone disconnection pause speech; transient focus interruptions may
resume when focus returns. MediaPlayer holds a partial wake lock only during playback; bounded
preparation holds one while initializing/synthesizing. Screen wakefulness is never requested.
The service outlives Activity pause/destroy, screen-off and WebView suspension. App lock still
protects the page while transport controls remain usable. A server-origin change stops speech;
recreating the Activity on the same origin preserves playback. Native snapshots are origin-scoped.

The in-app player is a normal-flow row below navigation/connection status. A native observer
signals state changes, and the UI refreshes on foreground return; no periodic polling runs.
System media controls are the external player; no overlay permission or external popup exists.
Samsung decides Now Bar presentation, which must be checked on a real supported Galaxy device.
No specific Samsung layout or availability is assumed. The default engine may use network
synthesis according to the selected Android voice; this is not a cloud TTS request by Chungus.

APK 0.1.9 adds Settings → TTS on Android only. `SpeechSettings` enumerates available voices
using a temporary TTS client, closes that connection, and validates saves against its catalog.
Voices marked not installed are excluded. Native private preferences bind an explicit voice
name to its engine, with a bounded 0.5–2.0 speech rate; pitch is not exposed or modified.
Each new reading captures the options once and configures synthesis before generating any
audio, so queued audio never mixes voices/rates and an active reading is not interrupted.
Changing the Android default engine or losing a selected voice prompts reselection rather
than silently switching language. Device-default voice is available as an explicit reset.
The frontend coalesces slider writes, serializes native saves, preserves newer gestures over
late replies, and exposes save failures for retry. The range is a normal input covered by
the global `protectTouchRanges` policy, including scrolling/cancel restoration.

Since APK 0.1.2, the optional `save(filename, mime, producer)` adapter opens the destination
picker before invoking the web file producer. Character export uses `saveGeneratedDownload`
for a single PNG/JSON/CHARX or a bulk ZIP. Cancelling the picker does not fetch or encode art;
producer failures abort and delete the selected partial document, then reach the existing
export dialog error handler. Older APKs and normal browsers keep the anchor-download path.
The per-export portrait promise is reused for the PNG canvas and V3 native icon asset.

The native root applies system-bar, display-cutout and IME padding and returns consumed
insets. Descendant WebViews must not apply the same insets a second time through their
viewport/CSS safe-area values. System bars stay visible; native UI strings are English.

Validation: Kotlin tests cover HTTPS origin boundaries, safe names and binary export ordering/
size. Bun tests execute the actual injected script against blob/HTTP downloads, cancellation,
IO failure and frame boundaries. A browser integration check exercises the real Svelte dialogs,
settings drill-down and Home with the injected adapter. Android lint and APK assembly run with
Gradle. Native keyboard/SAF behavior still needs a real device or emulator to verify end to end.


### Device-local speech text processing

APK 0.1.9 adds `speech.rules` and `speech.rules.save` behind the existing exact-origin, main-frame, unlocked bridge guard. Rules live in private `read-aloud` SharedPreferences, separately from voice and rate, with bounded, unique IDs and a maximum of 30 patterns of 1,000 characters each. Native code validates the schema and preserves list order; it never executes user regex on the Android main thread.

The web reader fetches the saved list at each new playback request, after the original message content has become plain text and before native sentence splitting. Identity macros resolve first, but display-scope regex never runs on the speech source. Markdown rendering and sanitization are used only for safe plain-text extraction, so HTML comments are discarded without becoming display widgets. The same terminable module worker executes draft previews and playback filtering. Each enabled rule removes all literal or JavaScript regex matches, optionally case-sensitive, from the preceding output. The worker validates disabled patterns as well. A 1.5-second execution watchdog terminates pathological regex after the worker is ready; loading the worker asset has a separate 15-second deadline. Errors and empty results prevent playback instead of falling back to unfiltered text; existing playback is not replaced until preprocessing succeeds. Original chat content and server settings remain unchanged.

Settings use explicit Save rules for atomic list/order persistence. Draft previews never synthesize audio. Drag ordering reuses the steering library's `svelte-dnd-action` handle-only pattern with a touch delay and keyboard support. The preview accepts plain text because playback's original-message-to-text conversion already precedes the rule stage.


APK 0.1.10 adds optional `name` metadata to each speech rule, bounded to 120 UTF-16 characters and defaulting to empty for older records. Native validation and serialization preserve the label alongside its stable ID; the worker ignores metadata. `readingRuleNames` capability gates name editing because older bridge/native serializers discard unknown fields. The editor shows legacy or blank names as numbered labels, starts collapsed, expands one rule at a time, and preserves drafts across folding and drag ordering. Invalid-pattern validation expands the first failing rule. Saving still commits the entire ordered list atomically.


The Threads feed offers Read aloud on Android beside Copy and Share. It uses exactly Copy's `serializeFeedAsPlainText(activeThreadsFeed(round))` source, preserving title, usernames, post and nested reply order for the selected version instead of speaking the stored JSON. No display regex or extra Markdown conversion runs on that source. Device-local TTS rules, voice, speed and the shared native player still apply. The button is disabled while a reading request is pending, and startup errors reach the normal toast channel.

### Read-aloud startup latency

APK 0.1.11 shares a `SpeechEnginePool` between foreground warm-up and the native media service. The visible, unlocked activity retains an application-context TTS connection without requesting audio focus, synthesizing speech, holding a wake lock, or starting a foreground service. Playback acquires that same connection, captures its original default voice, and configures the current saved voice/rate. `PreparedResource` tracks owners and initialization generations: backgrounding/locking releases the activity's ownership, while active playback retains its own connection until the reader closes. Stale callbacks cannot revive stopped readers. Errors discard the connection, subsequent reads can retry, and each acquisition checks whether the Android default engine changed. Voice discovery in settings remains a separate temporary connection.

The web player prepares one reusable speech-rules worker while visible. Preview and playback jobs run sequentially with unique request IDs and isolated text/rule payloads. Every job keeps the 1.5-second watchdog; loading still has a separate 15-second deadline. Timeouts/errors terminate the worker and reject all affected jobs, with no unfiltered fallback. Suspending allows already-requested processing to finish and then releases the worker. Returning to the foreground prepares it again. Rules are still loaded fresh from native preferences for each reading.

Diagnostics use monotonic clocks and record durations only, never source text, titles, or patterns. The web store retains `lastProcessingTiming` and logs `[TTS startup] rules` (native rule-fetch time, worker wait, processing round trip, total, and reuse). Native `ChungusTTS` logcat records engine initialization and acquisition wait; `readingState().startup` exposes `engineInitializationMs`, `engineWaitMs`, and `engineReused` for the current reading. Initialization time includes warm-up before the tap; acquisition wait measures only time the playback request actually waited. These values exclude audio synthesis and player preparation. Run `bun scripts/benchmark-speech-rules.ts` for a reproducible synthetic cold-worker versus ready-worker comparison on the development machine; Android engine timings require running the APK on a device. Sentence splitting, synthesis units, and playback controls are unchanged.

### Playing alongside other audio

APK 0.1.11 adds the optional `mixAudio` boolean to device-local speech settings, defaulting to false for existing installations. The `readingMixAudio` bridge capability gates the Settings → TTS switch so older APKs cannot silently discard it. Native loads/saves preserve it alongside voice and speed; a save from an older web interface that omits the field preserves the stored value. Non-boolean payloads are rejected. Changes apply to the next reading.

Each reading captures the setting once and builds its own `AudioFocusRequest` after abandoning the previous request. Standard mode keeps `AUDIOFOCUS_GAIN`; alongside mode uses `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` so compatible music players may continue at reduced volume. Android and the other player decide whether to duck or pause; simultaneous playback cannot be guaranteed for every app. The reader still pauses on focus loss, calls, and headphone disconnection. Pause, stop, completion, and failure release focus so other audio can recover its volume. Resume/skip use the captured mode, and delayed focus callbacks from older readings are ignored. No permission to overlay or ignore audio-focus loss is added.

### Sentence highlighting

APK 0.1.12 adds device-local `highlightSpeech` (default true) and the `readingHighlights` capability. Settings → TTS can turn it off for the next reading. Older interfaces that omit the preference preserve its value; older APKs show a disabled switch. `SpeechText.parts` returns the same synthesis units as before with exact UTF-16 start/end offsets in the filtered text. Native snapshots include a bounded opaque reading request ID and the current range only after that part starts playing; pause retains it, preparation/error/stop clear it. Highlight timing follows MediaPlayer playback, never synthesis or next-part prefetch. No source text is added to progress events or OS metadata.

The rules worker can optionally retain an original-character offset for every surviving output character, including sequential deletions and whitespace cleanup. Preview output and spoken text are unchanged. These maps stay in WebView memory; only the final filtered text and reading ID cross the native bridge. The web store binds them to the initiating chat/message or Threads round/version and rejects stale IDs, invalid ranges, and edits. Failed preprocessing keeps existing playback/highlights intact. A WebView reload does not guess a previous source; normal background/foreground transitions retain the session.

The rendering action maps the original plain speech source onto existing text nodes. It accepts a unique complete-text match or intact blocks with matching occurrence counts. Rewritten or ambiguous duplicate blocks remain unhighlighted; it never switches speech to display-regex output. Mapping is bounded and cached only for the active reading. Threads scopes include title/post/comment text and exclude engagement controls. Render changes and detail toggles invalidate the mapping. CSS Custom Highlight ranges paint only retained characters and preserve DOM nodes, selection, formatting and scroll position. Unsupported WebViews continue playback without a DOM-rewriting fallback. The opaque theme accent is the backing color; WCAG contrast picks pure black or white for the foreground, including dialogue and formatted spans. Moving or removing the highlight restores the original colors. The highlight registry key is independent of Find in chat.
