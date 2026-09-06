/**
 * Client transport layer.
 *
 * Single place that talks to the self-hosted server: bearer-token auth, the DB
 * RPC bridge, generic REST helpers for files/presets/prompts, and the WebSocket
 * used for live cross-device sync and streaming LLM tokens.
 *
 * Nothing here touches the network at import time, so it is safe during
 * prerendering. The browser-only bits guard on `typeof window`.
 */
import type { BackupsPayload } from '$shared/backups';

/**
 * Identifies this PAGE, not this device. It exists for exactly one job: the server skips
 * echoing a mutation's sync hint back to whoever caused it. That "whoever" is a page: a
 * second tab on the same machine has its own stores to keep fresh and must be told. Keep it
 * anywhere every tab shares, localStorage above all, and two windows go mutually blind: each
 * other's changes are suppressed as their own echo.
 */
const CLIENT_ID = typeof window === 'undefined' ? 'ssr' : crypto.randomUUID();

// ===== Access control =====

/** Thrown when the server rejects this device's IP (HTTP 403). */
export class AccessDeniedError extends Error {
	constructor(message = "This device isn't allowed to access ChungusHub.") {
		super(message);
		this.name = 'AccessDeniedError';
	}
}

/**
 * Thrown when the server is up and deliberately not serving (HTTP 503): a restore is being
 * prepared or is waiting for the next launch. Carries the server's own two lines, since it
 * is the only side that knows which of those it is and what the reader has to do about it.
 */
export class MaintenanceError extends Error {
	detail: string;
	constructor(headline: string, detail: string) {
		super(headline);
		this.name = 'MaintenanceError';
		this.detail = detail;
	}
}

export function getClientId(): string {
	return CLIENT_ID;
}

/** Plain file URL. Access is gated server-side by IP, so no token is needed. */
export function fileUrl(relativePath: string): string {
	return `/files/${relativePath}`;
}

export async function getServerConfig(): Promise<{ dataEpoch: number; dataAhead: boolean }> {
	return (await apiGet('/api/config')) as { dataEpoch: number; dataAhead: boolean };
}

/** A blocked connection attempt the server remembers for one-click allow. */
export interface DeniedAttempt {
	ip: string;
	lastSeen: number;
}

export interface AccessInfo {
	allowed: string[];
	/** Blocked attempts, newest first. */
	recent: DeniedAttempt[];
	/** IPs holding a live WebSocket right now: the presence dots on the device list. */
	online: string[];
	yourIp: string | null;
	/** Whether this device would get past the allowlist if it were switched on. Not the
	 *  same as `allowed.includes(yourIp)`: loopback and the env seeds pass without ever
	 *  appearing in that list. */
	yourIpAllowed: boolean;
}

export async function getAccessInfo(): Promise<AccessInfo> {
	return (await apiGet('/api/access')) as AccessInfo;
}

export async function allowIpAddress(ip: string): Promise<AccessInfo> {
	return (await apiSend('/api/access/allow', 'POST', { ip })) as AccessInfo;
}

export async function revokeIpAddress(ip: string): Promise<AccessInfo> {
	return (await apiSend('/api/access/revoke', 'POST', { ip })) as AccessInfo;
}

// ===== Security switches (network access + allowlist toggle + password lock) =====

export interface SecurityInfo {
	/** The master switch: is the server's port open on the network at all. */
	networkAccessEnabled: boolean;
	ipAllowlistEnabled: boolean;
	/** The lock is actually asking devices for the password right now. */
	passwordEnabled: boolean;
	/** A password exists (the lock can be switched on without retyping one). */
	passwordSet: boolean;
	/** Minutes a device may go idle before it must unlock again; 0 never asks again. */
	sessionIdleMinutes: number;
}

export async function getSecurityInfo(): Promise<SecurityInfo> {
	return (await apiGet('/api/security')) as SecurityInfo;
}

// ===== Backups =====

/** Everything the Backups page draws, plus the two facts only the server can answer: the
 *  schema this build reads, and whether a restore is already claimed for the next launch. */
export async function getBackups(): Promise<
	BackupsPayload & { schemaVersion: number; restorePending: string | null }
> {
	return (await apiGet('/api/backups')) as BackupsPayload & {
		schemaVersion: number;
		restorePending: string | null;
	};
}

/** Starts a snapshot and returns immediately; the job outlives this request and the page. */
export async function startBackup(label: string | null): Promise<void> {
	await apiSend('/api/backups/snapshot', 'POST', { label });
}

/** Claims the next launch for a restore. From here the server stops accepting work. */
export async function startRestore(id: string): Promise<void> {
	await apiSend('/api/backups/restore', 'POST', { id });
}

/** Withdraws a claimed restore before any relaunch applies it. The server resumes work. */
export async function cancelRestore(): Promise<void> {
	await apiSend('/api/backups/cancel-restore', 'POST');
}

export async function deleteBackups(ids: string[]): Promise<number> {
	const data = (await apiSend('/api/backups/delete', 'POST', { ids })) as { removed: number };
	return data.removed;
}

export async function pinBackup(id: string, pinned: boolean): Promise<void> {
	await apiSend('/api/backups/pin', 'POST', { id, pinned });
}

/** What restoring this snapshot would discard, counted on the live database right now. */
export async function getBackupLoss(
	id: string
): Promise<{ since: number; chats: number; messages: number; characters: number }> {
	return (await apiGet(`/api/backups/loss?id=${encodeURIComponent(id)}`)) as {
		since: number;
		chats: number;
		messages: number;
		characters: number;
	};
}

/** Open the app's port to the network, or close it back down to this computer alone.
 *  The server re-opens its socket either way, so every live connection drops. */
export async function setNetworkAccessEnabled(enabled: boolean): Promise<void> {
	await apiSend('/api/security/network-access', 'POST', { enabled });
}

export async function setIpAllowlistEnabled(enabled: boolean): Promise<void> {
	await apiSend('/api/security/ip-allowlist', 'POST', { enabled });
}

/** Set or change the password (switches the lock on). Other devices' sessions
 *  are invalidated; the response cookie keeps this one logged in. */
export async function setSecurityPassword(password: string): Promise<void> {
	await apiSend('/api/security/password', 'POST', { password });
}

/** Flip the lock on/off; the stored password survives an off. */
export async function setPasswordLockEnabled(enabled: boolean): Promise<void> {
	await apiSend('/api/security/password/enabled', 'POST', { enabled });
}

/** How long a device may go idle before it must unlock again. 0 never asks again. */
export async function setSessionIdleMinutes(minutes: number): Promise<void> {
	await apiSend('/api/security/session-idle', 'POST', { minutes });
}

// ===== About =====

/** What Settings → About can say about the machine this is installed on. Shape hand-kept
 *  against `InstallInfo` in server/about.ts. */
export interface InstallInfo {
	/** The SERVER's number: 'dev' when it runs from source, unlike the client's baked one. */
	version: string;
	build: 'portable' | 'source';
	runtime: string;
	platform: string;
	dataDir: string;
	dataBytes: number;
	imageBytes: number;
}

export async function getInstallInfo(): Promise<InstallInfo> {
	return (await apiGet('/api/about')) as InstallInfo;
}

/** The newest published release, as GitHub reports it. The comparison happens on the client,
 *  against the number baked into this bundle: the server answers 'dev' from source and could
 *  not weigh itself against anything. */
export interface LatestRelease {
	version: string;
	url: string;
}

/** Leaves the machine. Only ever called from a press on the About page, which says so first. */
export async function checkLatestRelease(): Promise<LatestRelease> {
	return (await apiGet('/api/about/latest-release')) as LatestRelease;
}

// ===== REST helpers =====

async function parseOrThrow(res: Response): Promise<unknown> {
	if (res.status === 403) {
		throw new AccessDeniedError();
	}
	if (res.status === 401) {
		// The password lock engaged or this session expired mid-use; a reload
		// lands on the server's unlock page.
		if (typeof window !== 'undefined') window.location.reload();
		throw new AccessDeniedError('Password required.');
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 503 && (data as { maintenance?: boolean }).maintenance) {
		const state = data as { error?: string; detail?: string };
		throw new MaintenanceError(state.error ?? 'ChungusHub is busy.', state.detail ?? '');
	}
	if (!res.ok) {
		throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
	}
	return data;
}

export async function apiGet(path: string): Promise<unknown> {
	const res = await fetch(path);
	return parseOrThrow(res);
}

export async function apiSend(path: string, method: string, body?: unknown): Promise<unknown> {
	const res = await fetch(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return parseOrThrow(res);
}

export async function apiUpload(path: string, form: FormData): Promise<unknown> {
	const res = await fetch(path, { method: 'POST', body: form });
	return parseOrThrow(res);
}

/** DB RPC bridge: calls a whitelisted method on the server's DatabaseService. */
export async function dbRpc(method: string, args: unknown[]): Promise<unknown> {
	const data = (await apiSend('/api/rpc/db', 'POST', {
		method,
		args,
		clientId: getClientId()
	})) as { result: unknown };
	return data.result;
}

// ===== WebSocket: sync + LLM streaming =====

type SyncHandler = (scope: string) => void;
const syncHandlers = new Set<SyncHandler>();

export function onSync(handler: SyncHandler): () => void {
	syncHandlers.add(handler);
	return () => syncHandlers.delete(handler);
}

/**
 * Fires when the socket comes back after a drop, never for the first connect (boot has
 * just read everything). The server keeps no per-device queue, so every hint broadcast
 * while this device was away is gone: the listener's job is a full re-read, not a resume.
 */
const reconnectHandlers = new Set<() => void>();

export function onReconnect(handler: () => void): () => void {
	reconnectHandlers.add(handler);
	return () => reconnectHandlers.delete(handler);
}

/**
 * Whether this device can currently reach its server, for the one surface that says so out
 * loud. Deliberately NOT "the socket is open": a drop is reported only once a reconnect
 * attempt has failed, which puts a ~2s grace in front of it for free. Below that window sit
 * every sleeping laptop, every wifi hiccup and every dev-server restart, all of which heal on
 * the first retry, and a bar that flashed on each of those would be trained away in a day.
 * Past it, the host is genuinely unreachable, which is what makes the claim safe to print.
 */
type ReachabilityHandler = (reachable: boolean) => void;
const reachabilityHandlers = new Set<ReachabilityHandler>();
let reachable = true;

export function onReachabilityChange(handler: ReachabilityHandler): () => void {
	reachabilityHandlers.add(handler);
	return () => reachabilityHandlers.delete(handler);
}

export function isReachable(): boolean {
	return reachable;
}

function setReachable(next: boolean): void {
	if (reachable === next) return;
	reachable = next;
	for (const handler of reachabilityHandlers) handler(next);
}

/**
 * The two stream clocks live here and nowhere else, because this is the one place every
 * token frame passes through. A caller measuring them at its own call site would need a
 * copy per call site, and each copy would start its clock at a different point.
 */
interface PendingLlm {
	resolve: (result: LlmResult) => void;
	reject: (err: Error) => void;
	onToken?: (token: string) => void;
	onThinkingToken?: (token: string) => void;
	/** Zero point for both clocks: the moment the request left this page. */
	startedAt: number;
	/** First token of either kind. Stays unset on a non-streamed call, where none arrives. */
	firstTokenAt?: number;
	/** The reasoning stream's own span, stamped on every thinking token. */
	thinkingFirstAt?: number;
	thinkingLastAt?: number;
	/** Armed on abort: the grace window for the server's final (cancelled) result. */
	cancelTimer?: ReturnType<typeof setTimeout>;
	/** Characters of each stream already applied here, which is what a re-attach asks the
	 *  server to skip. Counted from what `onToken` was actually handed, so the two can't drift. */
	receivedContent: number;
	receivedThinking: number;
	/** This request has lived through a dropped socket. Both clocks above are measured from
	 *  frame ARRIVAL, so the gap is inside them and nothing honest can be read off either. */
	reattached?: boolean;
	/** A Stop pressed while the socket was down, waiting for a connection to land on. */
	cancelPending?: boolean;
}

export interface LlmResult {
	content: string;
	thinking: string | null;
	finishReason: 'stop' | 'length' | 'error' | 'cancelled';
	usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
	model: string;
	provider: string;
	/** Request start → the first streamed token of either kind, in ms. Null when nothing
	 *  streamed: a non-streamed call, or a stop that beat the first token. */
	firstTokenMs: number | null;
	/** How long the reasoning stream ran, first thinking token to last, in ms. Null when the
	 *  turn produced no reasoning. A provider that buffers its reasoning and flushes it in one
	 *  frame reports a span near zero, because that is what it did: the thinking time it hid
	 *  lands in `firstTokenMs`, where the wait actually showed. */
	reasoningMs: number | null;
	/** The row this reply was written as, for a request that carried a `commit` placement.
	 *  Null for every other call, and also for a committing one that had nothing to land: a
	 *  stop before the first token, or a chat deleted while the model was writing. */
	committedMessageId: string | null;
	/** The one-shot steering notes the commit really deleted, which is a subset of what the
	 *  request asked it to spend: a note edited to permanent, or deleted, while the model was
	 *  writing is left armed. Empty for every non-committing call. */
	spentSteeringIds: string[];
	/** This request lived through a dropped socket, so no duration measured on this side
	 *  means anything: the gap is inside it. `firstTokenMs`/`reasoningMs` are already nulled
	 *  here, and a caller clocking the call itself owes the same (architecture/llm-providers.md). */
	reattached: boolean;
}


const pendingLlm = new Map<string, PendingLlm>();

// ===== Prompt debug log bus =====
//
// A thin pub/sub that mirrors `onSync`: the server captures every LLM request (and the
// real result it returns) and broadcasts it here so the debug panel can render it.
// Transport stays decoupled from any store: the prompt-log store subscribes via
// onPromptLog and flips `promptLogEnabled` on/off. That flag gates nothing locally: it
// only tells the server whether this device wants the feed, and the server records while
// ANY device is listening, so a broadcast that arrives is always re-emitted.

/** A faithful snapshot of one message in a logged request. */
export interface PromptLogMessage {
	role: string;
	content: string;
	/** Chat image attachments as server-relative paths (never raw bytes). */
	images?: string[];
}

/** A snapshot of an outgoing LLM request, exactly as it goes over the wire. */
export interface PromptLogRequest {
	id: string;
	source: string;
	kind: 'completion';
	provider: string;
	model: string;
	messages: PromptLogMessage[];
	params?: Record<string, string | number>;
	maxTokens?: number;
	temperature?: number;
	stream: boolean;
	/** Reasoning/verbosity/media/caching tuning the request carried. */
	tuning?: import('$lib/types/llm').GenerationTuning;
	/** The connection's OpenRouter routing for this request (null/absent elsewhere). */
	routing?: import('$lib/types/llm').RoutingConfig | null;
	startedAt: number;
}

/** The real envelope that came back, attached to the matching request by id. */
export interface PromptLogResult {
	status: 'done' | 'error' | 'cancelled';
	endedAt: number;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
	finishReason?: string;
	model?: string;
	provider?: string;
	error?: string;
	/** The response body the provider returned (thinking is extracted separately). */
	responseContent?: string;
	responseThinking?: string;
}

export type PromptLogEvent =
	| { type: 'request'; entry: PromptLogRequest }
	| { type: 'result'; id: string; result: PromptLogResult };

type PromptLogHandler = (ev: PromptLogEvent) => void;
const promptLogHandlers = new Set<PromptLogHandler>();
type PromptLogClearHandler = () => void;
const promptLogClearHandlers = new Set<PromptLogClearHandler>();
let promptLogEnabled = false;

export function onPromptLog(handler: PromptLogHandler): () => void {
	promptLogHandlers.add(handler);
	return () => promptLogHandlers.delete(handler);
}

/** Fired when any device clears the shared debug log. */
export function onPromptLogClear(handler: PromptLogClearHandler): () => void {
	promptLogClearHandlers.add(handler);
	return () => promptLogClearHandlers.delete(handler);
}

/**
 * The store keeps this in sync with the Advanced toggle. Logs are captured and
 * broadcast server-side now, so this just tells the server whether this device wants
 * the feed. The server only records while at least one device is listening.
 */
export function setPromptLogEnabled(value: boolean): void {
	promptLogEnabled = value;
	sendDebugState();
}

/** Tell the server this device's current debug state (re-sent on every reconnect). */
function sendDebugState(): void {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ t: 'debug', on: promptLogEnabled }));
	}
}

function emitPromptLog(ev: PromptLogEvent): void {
	for (const handler of promptLogHandlers) handler(ev);
}

function emitPromptLogClear(): void {
	for (const handler of promptLogClearHandlers) handler();
}

/** A reply being written for a chat, as `llmStatus` reports it. */
export interface LiveChatGeneration {
	chatId: string;
	requestId: string;
	/** How long it has been running. Measured server-side and sent as a duration, so the two
	 *  machines' clocks never have to agree about when it started. */
	runningMs: number;
}

/** In-flight llm-status requests, resolved by the matching llm-status-result. */
const pendingLlmStatus = new Map<string, { resolve: (r: LiveChatGeneration[]) => void; reject: (e: Error) => void }>();

let ws: WebSocket | null = null;
let wsReady: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** How long a connection attempt may hang before it counts as a failure. */
const CONNECT_TIMEOUT_MS = 5_000;
/** How long a Stop waits for the server's final (cancelled) result before settling as a
 *  plain abort. Only a server that has stopped answering on a live socket gets here. */
const CANCEL_GRACE_MS = 5_000;
/** How long a Stop pressed with no socket waits for one to travel on. Comfortably past the
 *  2s reconnect cadence, and short enough that a host which never returns cannot leave the
 *  composer holding a button that does nothing. */
const PARKED_CANCEL_MS = 30_000;
/** Whether a socket has ever opened: tells the first connect apart from a reconnect. */
let hasConnected = false;

/** The Bun server's port, baked in by vite.config.ts. Read in dev only, by `wsUrl`. */
declare const CHUNGUS_SERVER_PORT: number;

function wsUrl(): string {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	// The one request that deliberately does not ride the dev proxy: a proxied upgrade rests on
	// the runtime's own upgrade path, and a runtime that stops emitting that event leaves the
	// handshake hanging with no error, no close and nothing to report. In production this host
	// IS the origin serving the page, so only dev differs, and the server gains the device's
	// real address in place of the proxy's loopback.
	const host = import.meta.env.DEV ? `${location.hostname}:${CHUNGUS_SERVER_PORT}` : location.host;
	return `${proto}://${host}/ws?clientId=${encodeURIComponent(getClientId())}`;
}

export function connectWs(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return wsReady ?? Promise.resolve();
	}

	wsReady = new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(wsUrl());
		ws = socket;

		// A host that is powered off, asleep or firewalled never answers the SYN at all, and
		// the OS sits on that for ~20s before calling it: no error, no close, nothing. The
		// reachability signal rides the outcome of this attempt, so it has to be settled on a
		// human timescale rather than a TCP one.
		const openTimer = setTimeout(() => {
			socket.close();
			reject(new Error('WebSocket connection timed out'));
		}, CONNECT_TIMEOUT_MS);

		socket.onopen = () => {
			clearTimeout(openTimer);
			// Re-announce this device's debug state so the shared log keeps flowing here
			// after a reconnect.
			sendDebugState();
			startHeartbeat();
			setReachable(true);
			if (hasConnected) {
				// Before the scope handlers: a generation still running is state this page owns
				// and the re-reads below know nothing about.
				reattachGenerations();
				for (const handler of reconnectHandlers) handler();
			}
			hasConnected = true;
			resolve();
		};
		socket.onerror = () => {
			clearTimeout(openTimer);
			reject(new Error('WebSocket connection failed'));
		};
		socket.onclose = () => {
			clearTimeout(openTimer);
			handleSocketDown(socket);
		};
		socket.onmessage = (event) => handleWsMessage(event.data);
	});

	return wsReady;
}

/** The one path out of a live socket, whether the browser noticed the drop (`onclose`) or
 *  the heartbeat did. Bails when a newer socket has already taken over, so a late close
 *  event from the old one cannot reject the new connection's in-flight work. */
function handleSocketDown(socket: WebSocket): void {
	if (ws !== socket) return;
	ws = null;
	stopHeartbeat();
	// Generations SURVIVE a dropped socket: the server keeps running them and holds what they
	// streamed, so the pending stays and claims it back on the next open (`reattachGenerations`).
	// A Stop already in flight is NOT settled here either, for the same reason: the generation
	// it was aimed at is still running, and giving up on it locally would leave it going with
	// nobody able to stop it. The cancel waits for a socket to travel on.
	for (const [id, pending] of pendingLlm) {
		// A Stop whose grace window was still running: it may never have reached the server,
		// so it re-parks to travel on the next socket rather than being dropped here.
		if (pending.cancelTimer) parkLlmCancel(id, pending);
		pending.reattached = true;
	}
	for (const [, pending] of pendingLlmStatus) pending.reject(new Error('Connection lost'));
	pendingLlmStatus.clear();
	scheduleReconnect();
}

/**
 * Claim back every generation this page had in flight when the socket went away. Each one
 * says how much it already applied, so the server answers with the remainder alone and the
 * transcript picks up mid-word instead of repainting.
 *
 * A request the server never received (it was written into a socket that was already dying)
 * is answered as a miss and rejected, which is the truth: it never ran.
 */
function reattachGenerations(): void {
	for (const [id, pending] of pendingLlm) {
		ws?.send(
			JSON.stringify({
				t: 'llm-attach',
				id,
				haveContent: pending.receivedContent,
				haveThinking: pending.receivedThinking
			})
		);
	}
}

/** Send the Stop for a generation and arm the grace window for its final (cancelled) result. */
function sendLlmCancel(id: string, pending: PendingLlm): void {
	pending.cancelPending = false;
	if (pending.cancelTimer) clearTimeout(pending.cancelTimer);
	ws?.send(JSON.stringify({ t: 'llm-cancel', id }));
	pending.cancelTimer = setTimeout(() => {
		if (pendingLlm.delete(id)) pending.reject(abortError());
	}, CANCEL_GRACE_MS);
}

/**
 * Park a Stop that has no socket to travel on. It rides the next re-attach, which is what
 * keeps a reply from generating on with nobody able to stop it.
 *
 * The wait is BOUNDED, and that is not a detail: an `AbortSignal` fires once, so a second
 * press of Stop is a no-op, and a host that never comes back would leave the promise
 * unsettled, the streaming indicator spinning and `warnIfBusy` refusing every edit until the
 * page is reloaded. When the window runs out the Stop is answered as the abort it asked for.
 */
function parkLlmCancel(id: string, pending: PendingLlm): void {
	pending.cancelPending = true;
	if (pending.cancelTimer) clearTimeout(pending.cancelTimer);
	pending.cancelTimer = setTimeout(() => {
		// A re-attach that landed inside the window cleared the flag and sent the real cancel.
		if (!pendingLlm.get(id)?.cancelPending) return;
		pendingLlm.delete(id);
		pending.reject(abortError());
	}, PARKED_CANCEL_MS);
}

function scheduleReconnect(): void {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectWs().catch(() => {
			// One failed retry is the threshold the reachability contract above is written
			// against: anything that heals inside the 2s wait never gets here.
			setReachable(false);
			scheduleReconnect();
		});
	}, 2000);
}

// ===== Liveness =====
//
// A socket whose other end went away without a close frame (what a sleeping host leaves
// behind, and the usual shape on a LAN) stays `OPEN` here forever: no `onclose`, so no
// reconnect, so this device silently stops receiving sync hints. Probing for silence is the
// only way to notice, and **how long that takes is the latency of the connection bar**.
//
// The two numbers behind it are not the same kind of number, which is why neither is a
// constant. How long to WAIT for an answer decides false positives, and the honest value
// spans three orders of magnitude: a round trip on this LAN is a couple of milliseconds and
// one over a bad cellular link is seconds. So it is measured rather than guessed, with the
// estimator TCP uses for the identical problem (Jacobson/Karels: a smoothed mean plus four
// deviations, which widens itself on a jittery link and tightens on a steady one). How often
// to PROBE decides how stale our knowledge is allowed to get; it rides the same measurement
// so a fast link is checked often and a slow one is left alone.
//
// Both are clamped, and the floors matter more than the estimate: a LAN round trip of 2ms
// would put the window at single-digit milliseconds, where one blocked event loop on either
// end reads as a dead server. The floor is sized against a stalled main thread, not a packet.
//
// Two things keep an aggressive window safe. **Any inbound message counts as the answer**,
// not just the pong, so a socket delivering tokens is never torn down for a reply queued
// behind them, and the probe only ever fires against a genuinely quiet socket. And **silence
// has to happen twice**, the second time with double the window, before the socket is
// declared dead. That second round is worth its couple of seconds: tearing a socket down
// rejects every in-flight request, so a single hiccup during a long wait for a model's first
// token would otherwise kill the reply it was waiting for.

/** Smoothed round trip and its mean deviation, both in ms; `haveSample` gates them. */
let srtt = 0;
let rttvar = 0;
let haveSample = false;

/** Below this an answer window stops describing the network and starts describing whether
 *  either side's event loop happened to be busy. */
const ANSWER_FLOOR_MS = 1_000;
const ANSWER_CEILING_MS = 8_000;
const PROBE_FLOOR_MS = 1_000;
const PROBE_CEILING_MS = 5_000;
/** Consecutive silent probes that declare the socket dead. */
const STRIKES = 2;
/** A sample outside this is a clock adjustment or a frozen tab, not a round trip. */
const MAX_SAMPLE_MS = 30_000;

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function recordRoundTrip(ms: number): void {
	if (ms < 0 || ms > MAX_SAMPLE_MS) return;
	if (!haveSample) {
		srtt = ms;
		rttvar = ms / 2;
		haveSample = true;
		return;
	}
	rttvar = 0.75 * rttvar + 0.25 * Math.abs(srtt - ms);
	srtt = 0.875 * srtt + 0.125 * ms;
}

/** How long a probe may go unanswered. Without a sample yet, assume the worst link. */
function answerWindow(): number {
	if (!haveSample) return ANSWER_CEILING_MS;
	return clamp(srtt + 4 * rttvar, ANSWER_FLOOR_MS, ANSWER_CEILING_MS);
}

/** How long the socket may stay quiet before we ask. */
function probeInterval(): number {
	if (!haveSample) return PROBE_CEILING_MS;
	return clamp(8 * srtt, PROBE_FLOOR_MS, PROBE_CEILING_MS);
}

let probeTimer: ReturnType<typeof setTimeout> | null = null;
let answerTimer: ReturnType<typeof setTimeout> | null = null;
let probeSentAt = 0;
let lastInboundAt = 0;
let strikes = 0;
let watchingVisibility = false;

function startHeartbeat(): void {
	stopHeartbeat();
	strikes = 0;
	// Nothing measured yet, so the first probe goes out almost immediately: it costs one frame
	// and it is what replaces the pessimistic ceiling with this link's real round trip.
	lastInboundAt = 0;
	watchVisibility();
	scheduleProbe(300);
}

function stopHeartbeat(): void {
	if (probeTimer) {
		clearTimeout(probeTimer);
		probeTimer = null;
	}
	if (answerTimer) {
		clearTimeout(answerTimer);
		answerTimer = null;
	}
}

function scheduleProbe(delay: number): void {
	if (probeTimer) clearTimeout(probeTimer);
	probeTimer = setTimeout(runProbe, delay);
}

function sendProbe(socket: WebSocket): void {
	probeSentAt = performance.now();
	socket.send(JSON.stringify({ t: 'ping' }));
	answerTimer = setTimeout(onSilence, answerWindow() * (strikes + 1));
}

/** The one recurring timer. It fires on the schedule but only ASKS when the socket has
 *  actually been quiet: traffic is its own proof, so a streaming reply pushes the next probe
 *  out for free rather than costing a timer reset per token. */
function runProbe(): void {
	probeTimer = null;
	const socket = ws;
	if (!socket || socket.readyState !== WebSocket.OPEN) return;

	const wait = probeInterval();
	// Never two outstanding: the probe already waiting on an answer owns the strike count,
	// and a second one would overwrite its window and reset the tally it is keeping.
	if (answerTimer) {
		scheduleProbe(wait);
		return;
	}

	// The quiet test is skipped while unmeasured, so the opening probe always gets to take
	// its sample even if the socket is busy with the reads that follow a connect.
	const quiet = performance.now() - lastInboundAt;
	if (haveSample && quiet < wait) {
		scheduleProbe(wait - quiet);
		return;
	}

	sendProbe(socket);
	scheduleProbe(wait);
}

function onSilence(): void {
	answerTimer = null;
	const socket = ws;
	if (!socket || socket.readyState !== WebSocket.OPEN) return;

	strikes += 1;
	if (strikes < STRIKES) {
		// Straight back out with a wider window: the second round exists for tolerance, so it
		// does not wait out another probe interval first.
		sendProbe(socket);
		return;
	}

	socket.close(4000, 'Liveness probe timed out');
	handleSocketDown(socket);
}

/**
 * A backgrounded tab has its timers throttled and then fires them in a burst on wake, which
 * can expire an answer window whose reply was frozen in the same queue. Coming back is
 * therefore treated as knowing nothing: strikes cleared, the estimate discarded so the next
 * window is the ceiling, and one probe sent shortly after to re-seed it.
 */
function watchVisibility(): void {
	if (watchingVisibility || typeof document === 'undefined') return;
	watchingVisibility = true;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible' || !ws) return;
		if (answerTimer) {
			clearTimeout(answerTimer);
			answerTimer = null;
		}
		strikes = 0;
		haveSample = false;
		lastInboundAt = 0;
		scheduleProbe(200);
	});
}

function handleWsMessage(raw: unknown): void {
	// Bytes from the server ARE the liveness proof the probe was asking for, whatever they say
	// and even if they turn out to be unparseable.
	lastInboundAt = performance.now();
	if (answerTimer) {
		clearTimeout(answerTimer);
		answerTimer = null;
		strikes = 0;
	}

	let msg: { t: string; [k: string]: unknown };
	try {
		msg = JSON.parse(String(raw));
	} catch {
		return;
	}

	switch (msg.t) {
		case 'sync':
			for (const handler of syncHandlers) handler(String(msg.scope));
			break;
		case 'pong':
			// The one message whose timing means something: it answers a probe we sent, so it
			// is the only round trip this layer can actually measure.
			recordRoundTrip(performance.now() - probeSentAt);
			break;
		case 'llm-token': {
			const pending = pendingLlm.get(String(msg.id));
			if (!pending) break;
			pending.firstTokenAt ??= performance.now();
			const token = String(msg.token);
			pending.receivedContent += token.length;
			pending.onToken?.(token);
			break;
		}
		case 'llm-thinking': {
			const pending = pendingLlm.get(String(msg.id));
			if (!pending) break;
			const at = performance.now();
			// Reasoning counts as the model speaking: on a model that thinks first, its first
			// thinking token IS the moment the wait ended, and timing from the first CONTENT
			// token instead would report the whole reasoning phase as dead air.
			pending.firstTokenAt ??= at;
			pending.thinkingFirstAt ??= at;
			pending.thinkingLastAt = at;
			const token = String(msg.token);
			pending.receivedThinking += token.length;
			pending.onThinkingToken?.(token);
			break;
		}
		case 'llm-attached': {
			// Everything that streamed while this page was not listening, in one piece.
			// Thinking first, because that is the order it arrived in on the server.
			const pending = pendingLlm.get(String(msg.id));
			if (!pending) break;
			const thinking = String(msg.thinking ?? '');
			const content = String(msg.content ?? '');
			if (thinking) {
				pending.receivedThinking += thinking.length;
				pending.onThinkingToken?.(thinking);
			}
			if (content) {
				pending.receivedContent += content.length;
				pending.onToken?.(content);
			}
			// A Stop pressed while there was no socket to send it on. It travels now, and the
			// generation answers it with the partial exactly as an unbroken one would have.
			if (pending.cancelPending) sendLlmCancel(String(msg.id), pending);
			break;
		}
		case 'llm-attach-miss': {
			// The server has never heard of this request: it restarted, or the answer waited
			// past its window, or the request died in the socket it was written to. Either way
			// there is nothing to come back for, and the caller has a composer locked on it.
			const pending = pendingLlm.get(String(msg.id));
			if (!pending) break;
			pendingLlm.delete(String(msg.id));
			if (pending.cancelTimer) clearTimeout(pending.cancelTimer);
			// Deliberately says nothing about whether anything was saved, because this side
			// cannot know: a story turn is written by the server, so one that finished before
			// the process lost track of it is already in the chat. Claiming either way would
			// be a guess, and the refresh the caller does on the way out shows the truth.
			pending.reject(new Error('Lost track of this generation when the connection dropped.'));
			break;
		}
		case 'llm-done': {
			const pending = pendingLlm.get(String(msg.id));
			if (pending) {
				pendingLlm.delete(String(msg.id));
				if (pending.cancelTimer) clearTimeout(pending.cancelTimer);
				// The server held this answer until somebody took it; tell it we have.
				ws?.send(JSON.stringify({ t: 'llm-release', id: String(msg.id) }));
				// The server owns the result; the two stream clocks are this side's alone,
				// since only this side saw the frames arrive. Which is exactly why a request
				// that lived through a drop reports neither: this page was not there for the
				// frames, so both would carry the length of the disconnection inside them.
				pending.resolve({
					...(msg.result as LlmResult),
					committedMessageId: typeof msg.committedMessageId === 'string' ? msg.committedMessageId : null,
					spentSteeringIds: Array.isArray(msg.spentSteeringIds) ? (msg.spentSteeringIds as string[]) : [],
					reattached: !!pending.reattached,
					firstTokenMs:
						pending.reattached || pending.firstTokenAt === undefined
							? null
							: Math.round(pending.firstTokenAt - pending.startedAt),
					reasoningMs:
						pending.reattached ||
						pending.thinkingFirstAt === undefined ||
						pending.thinkingLastAt === undefined
							? null
							: Math.round(pending.thinkingLastAt - pending.thinkingFirstAt)
				});
			}
			break;
		}
		case 'llm-error': {
			const pending = pendingLlm.get(String(msg.id));
			if (pending) {
				pendingLlm.delete(String(msg.id));
				ws?.send(JSON.stringify({ t: 'llm-release', id: String(msg.id) }));
				// A stopped request that errors instead of finishing has nothing streamed to
				// hand back (a non-streamed call, or an abort during the request itself), and
				// the message would just be the abort restated. Settle it as the clean abort
				// every caller's "a cancel is silent" branch is written against.
				if (pending.cancelTimer) {
					clearTimeout(pending.cancelTimer);
					pending.reject(abortError());
				} else {
					pending.reject(new Error(String(msg.message)));
				}
			}
			break;
		}
		case 'prompt-log':
			// The server is the single source for the debug log: it captures every
			// completion + assistant request centrally and broadcasts each change here, so
			// every device shows the same log.
			emitPromptLog(msg.event as PromptLogEvent);
			break;
		case 'prompt-log-clear':
			emitPromptLogClear();
			break;
		case 'llm-status-result': {
			const pending = pendingLlmStatus.get(String(msg.id));
			if (pending) {
				pendingLlmStatus.delete(String(msg.id));
				pending.resolve((msg.running as LiveChatGeneration[]) ?? []);
			}
			break;
		}
	}
}

export interface LlmRequest {
	/** The connection this generation rides: the server reads its key by this id. */
	connectionId: string;
	provider: string;
	model: string;
	messages: { role: 'user' | 'assistant' | 'system'; content: string; images?: string[] }[];
	maxTokens?: number;
	temperature?: number;
	/** Extra request-body fields (sampling knobs + service_tier) merged server-side. */
	params?: Record<string, string | number>;
	/** Reasoning/verbosity/media tuning; the server's providers translate what they support. */
	tuning?: import('$lib/types/llm').GenerationTuning;
	/** The connection's OpenRouter routing (openrouter only; ignored elsewhere). */
	routing?: import('$lib/types/llm').RoutingConfig | null;
	/** Debug-panel label for what kind of query this is (e.g. 'chat', 'memory'). */
	source?: string;
	/** The resolved connection's Stream response setting: the request's WIRE shape, which is
	 *  a different question from whether this caller wants the tokens. A call that streams
	 *  with no `onToken` is deliberate (see llmService.complete). */
	stream: boolean;
	/** Whether the server should send the tokens back as they arrive. False for a streamed
	 *  call whose caller reads none (every engine sidecar), which would otherwise push one
	 *  frame per token to a page that drops every one. The generation still accumulates
	 *  server-side, so a re-attach is answered exactly as it would be either way. */
	deliverTokens: boolean;
	onToken?: (token: string) => void;
	onThinkingToken?: (token: string) => void;
	signal?: AbortSignal;
	/** Present only for the two calls whose reply the SERVER writes into the story. The shape
	 *  is shared, since the server reads it off the wire (shared/generation.ts). */
	commit?: import('$shared/generation').GenerationCommit;
}

export async function llmComplete(req: LlmRequest): Promise<LlmResult> {
	await connectWs();
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		throw new Error('Not connected to server');
	}

	const id = crypto.randomUUID();

	return new Promise<LlmResult>((resolve, reject) => {
		if (req.signal?.aborted) {
			reject(abortError());
			return;
		}

		pendingLlm.set(id, {
			resolve,
			reject,
			onToken: req.onToken,
			onThinkingToken: req.onThinkingToken,
			startedAt: performance.now(),
			receivedContent: 0,
			receivedThinking: 0
		});

		req.signal?.addEventListener('abort', () => {
			const pending = pendingLlm.get(id);
			if (!pending || pending.cancelTimer || pending.cancelPending) return;
			// Don't reject yet: every provider answers an abort with a normal `llm-done`
			// carrying everything it streamed before the stop (finishReason 'cancelled').
			// Rejecting here threw that text away: a reply the user stopped mid-stream lost
			// every token they had watched arrive, and on a 'replace' regenerate the reply it
			// was replacing was already gone. The timer is the safety net for a server that
			// stops answering on a socket that is still up.
			if (ws && ws.readyState === WebSocket.OPEN) {
				sendLlmCancel(id, pending);
				return;
			}
			// No socket, and the generation on the other end is still running. A host that has
			// already failed a reconnect is answered on the spot, since nothing is coming;
			// anything else parks and travels on the next socket, under its own bounded wait.
			if (isReachable()) parkLlmCancel(id, pending);
			else if (pendingLlm.delete(id)) reject(abortError());
		});

		// Logging is captured server-side (the shared debug log). We just tag the request
		// with a source label so the panel can name it.
		ws!.send(
			JSON.stringify({
				t: 'llm',
				id,
				connectionId: req.connectionId,
				provider: req.provider,
				model: req.model,
				messages: req.messages,
				maxTokens: req.maxTokens,
				temperature: req.temperature,
				params: req.params,
				tuning: req.tuning,
				routing: req.routing,
				stream: req.stream,
				deliverTokens: req.deliverTokens,
				source: req.source ?? 'completion',
				commit: req.commit
			})
		);
	});
}

function abortError(): Error {
	const err = new Error('Aborted');
	err.name = 'AbortError';
	return err;
}

/**
 * Asks which of these chats have a reply being written for them right now, and how long each
 * one has been at it.
 *
 * A generation outlives the socket that asked for it, but a page's record of one does not
 * survive a reload: a phone whose tab the OS discarded comes back to a chat that IS busy with
 * nothing on screen saying so, and a send there is refused by the server with no Stop anywhere
 * to reach. This is how the chat finds out.
 *
 * It reports the reply's existence and its age, never its tokens. Claiming the stream would
 * point it at this socket and cut off whichever page is still watching it.
 */
export async function llmStatus(chatIds: string[]): Promise<LiveChatGeneration[]> {
	await connectWs();
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		throw new Error('Not connected to server');
	}
	const id = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		pendingLlmStatus.set(id, { resolve, reject });
		ws!.send(JSON.stringify({ t: 'llm-status', id, chatIds }));
	});
}

/**
 * Stop a generation this page never registered, by the id `llmStatus` named. The server
 * matches a Stop by request id across every socket, so this needs nothing but the id.
 * Throws with no connection rather than dropping the press: the generation would keep
 * running and the reader would think they had ended it.
 */
export function stopGeneration(id: string): void {
	if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Not connected to server');
	ws.send(JSON.stringify({ t: 'llm-cancel', id }));
}
