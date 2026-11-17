/**
 * The security switches, all managed from Settings → Security.
 *
 * `networkAccessEnabled` is the master one and is OFF by default. It is not a
 * gate: it decides where the listening socket is opened (index.ts `bindHostname`),
 * so while it is off the port exists on loopback alone and a device on the
 * network has nothing to reach rather than something that turns it away. The
 * other two are gates for non-loopback clients, including those coming through a proxy:
 *  - the IP allowlist itself can be turned off (open LAN access), and
 *  - a single shared password can be required from non-loopback devices.
 *    The password hash survives the lock being switched off, so it can be
 *    re-enabled without retyping a password.
 *
 * The password is stored as an argon2id hash (Bun.password); a successful
 * login mints a random session token delivered as an HttpOnly cookie.
 * Sessions use a sliding idle window: every gated request refreshes the
 * token's last-seen time, so a device in active use is never interrupted,
 * and one left alone re-locks once `sessionIdleMinutes` has passed. The default
 * is 0, which disables expiry by inactivity. Everything persists in
 * security.json under the data directory. Deleting that file restores the
 * defaults (network access off, allowlist on, no password), which is also the
 * lockout recovery path. Loopback is exempt from every gate here and is the one
 * address the socket is always on, so the host machine can always get in and
 * manage these settings.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { SECURITY_PATH } from './config';
import { watchDataFile } from './watch-file';

const SESSION_COOKIE = 'chungus_session';
// The idle window a device gets when the file says nothing. Its default, and the rule
// that 0 means never, are mirrored in vite.config.ts's dev gate: keep the two in sync.
const DEFAULT_SESSION_IDLE_MINUTES = 0;
const LEGACY_SESSION_IDLE_MINUTES = 60;
// A long-lived cookie lets a session survive closing the browser. The server
// independently enforces the configured inactivity limit and password changes.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
// last-seen writes are throttled to spare security.json a write per request.
const PERSIST_EVERY_MS = 60_000;
const MAX_LOGIN_FAILURES = 5;
const LOCKOUT_MS = 30_000;

interface SecurityState {
	/** The master switch: is the listening socket opened on the network at all. */
	networkAccessEnabled: boolean;
	ipAllowlistEnabled: boolean;
	/** The lock switch, independent of the hash so toggling off keeps the password. */
	passwordEnabled: boolean;
	passwordHash: string | null;
	/** How long a device may go untouched before it must unlock again. 0 = never. */
	sessionIdleMinutes: number;
	sessionIdleDefaultMigrated: boolean;
	/** token → last-seen time (ms). Persisted so a server restart keeps active devices in. */
	sessions: Record<string, number>;
}

/** Same stance as the allowlist, and it covers the file's SHAPE as much as its
 *  syntax: a `passwordHash` that parses fine but isn't a string would otherwise
 *  read as "no password" and silently unlock the app. Nothing here guesses. */
function unusable(reason: string): never {
	throw new Error(`security.json is unusable. Fix or delete it (${SECURITY_PATH}): ${reason}`);
}

/** A missing switch is "not stated" and takes the default; a switch that is present
 *  but isn't a boolean is a broken file, never a value to interpret. */
function boolField(raw: Record<string, unknown>, key: string): boolean | undefined {
	const value = raw[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') unusable(`"${key}" must be true or false`);
	return value;
}

/** Same stance as `boolField`: absent is "not stated", present but unusable is a broken
 *  file. A negative or fractional window would expire every session at once instead. */
function minutesField(raw: Record<string, unknown>, key: string): number | undefined {
	const value = raw[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		unusable(`"${key}" must be a whole number of minutes, 0 or more`);
	}
	return value;
}

function sessionsField(raw: Record<string, unknown>): Record<string, number> {
	const value = raw.sessions;
	if (value === undefined) return {};
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		unusable('"sessions" must be an object mapping a token to its last-seen time');
	}
	const sessions: Record<string, number> = {};
	for (const [token, lastSeen] of Object.entries(value)) {
		if (typeof lastSeen !== 'number' || !Number.isFinite(lastSeen)) {
			unusable(`session "${token}" has no valid last-seen time`);
		}
		sessions[token] = lastSeen;
	}
	return sessions;
}

function load(migrateLegacyDefault = false): SecurityState {
	if (!existsSync(SECURITY_PATH)) {
		return {
			networkAccessEnabled: false,
			ipAllowlistEnabled: true,
			passwordEnabled: false,
			passwordHash: null,
			sessionIdleMinutes: DEFAULT_SESSION_IDLE_MINUTES,
			sessionIdleDefaultMigrated: true,
			sessions: {}
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(SECURITY_PATH, 'utf8'));
	} catch (e) {
		unusable(e instanceof Error ? e.message : String(e));
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		unusable('the file must hold a JSON object');
	}
	const raw = parsed as Record<string, unknown>;
	const hash = raw.passwordHash;
	if (hash !== undefined && hash !== null && typeof hash !== 'string') {
		unusable('"passwordHash" must be a string or null');
	}
	const passwordHash = typeof hash === 'string' ? hash : null;
	const sessionIdleDefaultMigrated = boolField(raw, 'sessionIdleDefaultMigrated') ?? false;
	const defaultIdleMinutes = migrateLegacyDefault && !sessionIdleDefaultMigrated
		? LEGACY_SESSION_IDLE_MINUTES : DEFAULT_SESSION_IDLE_MINUTES;
	return {
		// Opening the app to the network is a deliberate act, so an absent switch
		// keeps it shut.
		networkAccessEnabled: boolField(raw, 'networkAccessEnabled') ?? false,
		ipAllowlistEnabled: boolField(raw, 'ipAllowlistEnabled') ?? true,
		// Files written before the switch existed imply "a hash means it's on".
		passwordEnabled: boolField(raw, 'passwordEnabled') ?? passwordHash !== null,
		passwordHash,
		sessionIdleMinutes: minutesField(raw, 'sessionIdleMinutes') ?? defaultIdleMinutes,
		sessionIdleDefaultMigrated,
		sessions: sessionsField(raw)
	};
}

let state: SecurityState;

/** Write to a temporary file and rename over the real one. A crash partway through a
 *  plain write leaves JSON that `load` refuses, and the only cure for that is deleting
 *  the file, which deletes the password with it. The rename is atomic, so a reader
 *  (including vite.config.ts, which re-reads this per request) sees one version or the
 *  other and never half of each. This file is rewritten roughly once a minute per
 *  active device to slide its idle window, so the window for a torn write is not small. */
function persist(): void {
	const temp = `${SECURITY_PATH}.tmp`;
	writeFileSync(temp, JSON.stringify(state, null, 2));
	renameSync(temp, SECURITY_PATH);
}

/** The live idle window. "Never" is Infinity rather than a flag, so every comparison
 *  below stays one expression. */
function sessionIdleMs(): number {
	return state.sessionIdleMinutes === 0 ? Infinity : state.sessionIdleMinutes * 60_000;
}

function pruneSessions(): void {
	const now = Date.now();
	const idleMs = sessionIdleMs();
	for (const [token, lastSeen] of Object.entries(state.sessions)) {
		if (now - lastSeen > idleMs) {
			delete state.sessions[token];
		}
	}
}

/** Load only after claiming the data directory. Write the settings on first boot
 * or once when migrating the former default, so 60 remains a valid choice afterwards. */
export function initializeSecurity(): void {
	const configured = existsSync(SECURITY_PATH);
	state = load(true);
	if (configured && state.sessionIdleDefaultMigrated) return;
	if (!state.sessionIdleDefaultMigrated && state.sessionIdleMinutes === LEGACY_SESSION_IDLE_MINUTES) {
		// Revoke sessions already expired under the old limit before removing it.
		pruneSessions();
		state.sessionIdleMinutes = DEFAULT_SESSION_IDLE_MINUTES;
	}
	state.sessionIdleDefaultMigrated = true;
	persist();
}

// ===== Switches =====

export function isNetworkAccessEnabled(): boolean {
	return state.networkAccessEnabled;
}

export function setNetworkAccessEnabled(enabled: boolean): void {
	state.networkAccessEnabled = enabled;
	persist();
}

export function isIpAllowlistEnabled(): boolean {
	return state.ipAllowlistEnabled;
}

export function setIpAllowlistEnabled(enabled: boolean): void {
	state.ipAllowlistEnabled = enabled;
	persist();
}

export function isPasswordEnabled(): boolean {
	return state.passwordEnabled && state.passwordHash !== null;
}

/** Whether a password has ever been set: the lock switch needs one to turn on. */
export function hasPassword(): boolean {
	return state.passwordHash !== null;
}

/** Set or change the password (and switch the lock on). Wipes every session
 *  (all devices re-login) and returns a fresh token so the calling device stays in. */
export function setPassword(password: string): string {
	state.passwordHash = Bun.password.hashSync(password);
	state.passwordEnabled = true;
	state.sessions = {};
	return createSession();
}

/** Flip the lock without touching the stored password. */
export function setPasswordLockEnabled(enabled: boolean): void {
	if (enabled && !state.passwordHash) throw new Error('Set a password first.');
	state.passwordEnabled = enabled;
	persist();
}

export function getSessionIdleMinutes(): number {
	return state.sessionIdleMinutes;
}

export function setSessionIdleMinutes(minutes: number): void {
	if (!Number.isSafeInteger(minutes) || minutes < 0) {
		throw new Error('The idle timeout must be a whole number of minutes, 0 or more.');
	}
	state.sessionIdleMinutes = minutes;
	// A shortened window drops what it just expired here, rather than leaving those
	// tokens in the file until their devices come back and are refused.
	pruneSessions();
	persist();
}

// ===== Login =====

/** ip → recent failure tracking, so the password can't be brute-forced quietly. */
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function isLockedOut(ip: string): boolean {
	const f = failures.get(ip);
	return !!f && f.lockedUntil > Date.now();
}

/** Verify a login attempt. Returns a session token on success, null on failure. */
export function login(password: string, ip: string): string | null {
	if (!state.passwordHash) return null;
	if (isLockedOut(ip)) return null;
	if (!Bun.password.verifySync(password, state.passwordHash)) {
		const f = failures.get(ip) ?? { count: 0, lockedUntil: 0 };
		f.count += 1;
		if (f.count >= MAX_LOGIN_FAILURES) {
			f.count = 0;
			f.lockedUntil = Date.now() + LOCKOUT_MS;
		}
		failures.set(ip, f);
		return null;
	}
	failures.delete(ip);
	return createSession();
}

function createSession(): string {
	pruneSessions();
	const token = randomBytes(32).toString('hex');
	state.sessions[token] = Date.now();
	persist();
	return token;
}

// ===== Cookie handling =====

/** Time of the last throttled last-seen write, per token. */
const lastPersisted = new Map<string, number>();

/**
 * Validate the session cookie and, when valid, slide its idle window forward.
 * The refresh is what makes active use never re-prompt: only a device that
 * sends no gated request for the whole window falls back to the unlock page.
 */
export function hasValidSession(cookieHeader: string | null): boolean {
	if (!cookieHeader) return false;
	const match = cookieHeader.match(/(?:^|;\s*)chungus_session=([a-f0-9]+)/);
	if (!match) return false;
	const token = match[1];
	const lastSeen = state.sessions[token];
	const now = Date.now();
	if (lastSeen === undefined || now - lastSeen > sessionIdleMs()) return false;
	state.sessions[token] = now;
	// Persisting every request would hammer security.json; once a minute is plenty, but
	// never longer than half the idle window: the file is what the dev gate and the next
	// boot read, and a stamp staler than the window itself locks out a device still in use.
	if (now - (lastPersisted.get(token) ?? 0) > Math.min(PERSIST_EVERY_MS, sessionIdleMs() / 2)) {
		lastPersisted.set(token, now);
		pruneSessions();
		persist();
	}
	return true;
}

// No Secure attribute: the server speaks plain HTTP, and a cookie the browser then
// refuses to send back would lock every other device out of a workspace it just
// unlocked.
export function sessionCookie(token: string): string {
	return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;
}

// ===== Edits made to the file directly =====

/** The switches as one comparable string. Sessions are deliberately out of it: they
 *  slide once a minute per active device, so counting them would make this server's
 *  own writes look like somebody's edit. */
function switchSignature(s: SecurityState): string {
	return [
		s.networkAccessEnabled,
		s.ipAllowlistEnabled,
		s.passwordEnabled,
		s.passwordHash,
		s.sessionIdleMinutes
	].join('|');
}

export interface SecurityChange {
	/** The listening socket has to move: this switch is what decides where it opens. */
	networkAccess: boolean;
	/** A gate closed, so connections opened while it was looser have to be dropped. */
	tightened: boolean;
}

/**
 * Apply edits made to security.json while the server is running, so configuring a
 * machine with no browser on it never means stopping and starting it. Only the switches
 * are taken from the file; sessions stay whatever this process holds, since those are
 * its own runtime state and the file is a mirror of them rather than the other way
 * around. The caller does what the matching switch in Settings → Security does.
 */
export function watchSecurityFile(apply: (change: SecurityChange) => void): void {
	watchDataFile(SECURITY_PATH, () => {
		let next: SecurityState;
		try {
			next = load();
		} catch (e) {
			// A half-saved or mistyped file arrives here instead of at boot. It is reported
			// and dropped: what is already in memory is good, and taking the process down
			// over a brace someone is still typing would take every connected device with
			// it. Starting on a broken file still refuses, which is where it matters.
			console.error('\n  security.json cannot be read, so the running settings stand:');
			console.error(`  ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		if (switchSignature(next) === switchSignature(state)) return;
		const change: SecurityChange = {
			networkAccess: next.networkAccessEnabled !== state.networkAccessEnabled,
			tightened:
				(next.ipAllowlistEnabled && !state.ipAllowlistEnabled) ||
				(next.passwordEnabled && !state.passwordEnabled) ||
				next.passwordHash !== state.passwordHash
		};
		state.networkAccessEnabled = next.networkAccessEnabled;
		state.ipAllowlistEnabled = next.ipAllowlistEnabled;
		state.passwordEnabled = next.passwordEnabled;
		state.passwordHash = next.passwordHash;
		// No kick for a shortened window: it is read per request, so the devices it
		// just expired are refused on their next one.
		state.sessionIdleMinutes = next.sessionIdleMinutes;
		console.log(
			`  security.json applied: network access ${state.networkAccessEnabled ? 'on' : 'off'}, ` +
				`allowlist ${state.ipAllowlistEnabled ? 'on' : 'off'}, ` +
				`password lock ${isPasswordEnabled() ? 'on' : 'off'}, ` +
				`idle timeout ${state.sessionIdleMinutes === 0 ? 'never' : `${state.sessionIdleMinutes}m`}.`
		);
		apply(change);
	});
}
