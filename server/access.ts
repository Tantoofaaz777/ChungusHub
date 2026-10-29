/**
 * IP allowlist access control for LAN self-hosting.
 *
 * No passwords, no tokens: a device may use ChungusHub only if its IP is on the
 * allowlist. Loopback (the host machine itself) is always allowed, so the owner
 * can always reach the app and manage which other devices get in. The allowlist
 * is a plain JSON array persisted under the data directory; entries seeded via
 * CHUNGUS_ALLOWLIST are always allowed but never written to the file.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { ALLOWLIST_ENV, ALLOWLIST_PATH } from './config.ts';
import { watchDataFile } from './watch-file.ts';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** Strip the IPv4-mapped IPv6 prefix so 192.168.1.3 and ::ffff:192.168.1.3 match. */
export function normalizeIp(ip: string): string {
	const trimmed = ip.trim();
	return trimmed.startsWith('::ffff:') ? trimmed.slice('::ffff:'.length) : trimmed;
}

/** The platform's own parser, so an out-of-range octet, a CIDR range or anything
 *  merely containing a colon is refused rather than filed away as an address no
 *  socket can ever match. */
function isValidIp(ip: string): boolean {
	return isIP(ip) !== 0;
}

/** Starting with an empty set would lock out every device AND the next allow/revoke
 *  would persist that empty set over the real list. That holds for a file that parses
 *  into the wrong shape just as much as one that doesn't parse at all. */
function unusable(reason: string): never {
	throw new Error(`allowlist.json is unusable. Fix or delete it (${ALLOWLIST_PATH}): ${reason}`);
}

function load(): Set<string> {
	if (!existsSync(ALLOWLIST_PATH)) return new Set();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
	} catch (e) {
		unusable(e instanceof Error ? e.message : String(e));
	}
	if (!Array.isArray(parsed)) unusable('the file must hold a JSON array of IP addresses');
	const ips = new Set<string>();
	for (const entry of parsed) {
		if (typeof entry !== 'string') unusable('every entry must be an IP address written as a string');
		ips.add(normalizeIp(entry));
	}
	return ips;
}

const envAllow = new Set(ALLOWLIST_ENV.map(normalizeIp));
const fileAllow = load();

/** Write-then-rename, same reason as security.json: a torn file is refused on the
 *  next boot, and the cure for that is deleting the list of every device you allowed. */
function persist(): void {
	const temp = `${ALLOWLIST_PATH}.tmp`;
	writeFileSync(temp, JSON.stringify([...fileAllow].sort(), null, 2));
	renameSync(temp, ALLOWLIST_PATH);
}

// First boot writes the empty list out rather than leaving the file implicit, same
// reason as security.json: on a machine with nothing to browse from, this file IS the
// device list, and a file that only appears after the first approval cannot be the
// place you go to make one.
if (!existsSync(ALLOWLIST_PATH)) persist();

function sameEntries(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const ip of a) if (!b.has(ip)) return false;
	return true;
}

/**
 * Apply edits made to allowlist.json while the server is running, so a device can be let
 * in from a text editor on a machine that has no browser to do it from.
 *
 * Nothing is dropped when an address leaves the list: `isAllowed` is read per request, so
 * a revoked device fails its next one, which is exactly what the Allowed devices list
 * does when the same address is removed with the button.
 */
export function watchAllowlistFile(): void {
	watchDataFile(ALLOWLIST_PATH, () => {
		let next: Set<string>;
		try {
			next = load();
		} catch (e) {
			// Reported and dropped rather than fatal, same stance as security.json: the list
			// in memory is good, and dying over a half-saved edit would turn away every
			// device on it. Booting on a broken file still refuses.
			console.error('\n  allowlist.json cannot be read, so the running device list stands:');
			console.error(`  ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		// The server writes this file itself on every approval, so a write is only somebody's
		// edit once the entries turn out to differ.
		if (sameEntries(next, fileAllow)) return;
		fileAllow.clear();
		for (const ip of next) fileAllow.add(ip);
		console.log(`  allowlist.json applied: ${fileAllow.size} device${fileAllow.size === 1 ? '' : 's'} allowed.`);
	});
}

/** The host machine itself, always allowed and never asked for the password. */
export function isLoopback(ip: string | null | undefined): boolean {
	return !!ip && LOOPBACK.has(normalizeIp(ip));
}

export function isAllowed(ip: string | null | undefined): boolean {
	if (!ip) return false;
	const norm = normalizeIp(ip);
	return LOOPBACK.has(norm) || envAllow.has(norm) || fileAllow.has(norm);
}

/** The user-managed entries (loopback and env seeds are implicit, not listed). */
export function listAllowed(): string[] {
	return [...fileAllow].sort();
}

export function allowIp(ip: string): void {
	const norm = normalizeIp(ip);
	if (!isValidIp(norm)) throw new Error(`Not a valid IP address: "${ip}"`);
	fileAllow.add(norm);
	denied.delete(norm);
	persist();
}

export function revokeIp(ip: string): void {
	if (fileAllow.delete(normalizeIp(ip))) persist();
}

// ----- Denied-attempt tracking (one-click allow in the settings UI) -----

// In-memory only: a restart drops the hints, and a still-blocked device
// repopulates them on its next attempt (the denied page retries itself).
// The Map stays in recency order because a repeat hit re-inserts its key.
const MAX_DENIED = 20;
const denied = new Map<string, number>(); // normalized ip → last attempt (ms)

export function recordDenied(ip: string | null | undefined): void {
	if (!ip) return;
	const norm = normalizeIp(ip);
	denied.delete(norm);
	denied.set(norm, Date.now());
	while (denied.size > MAX_DENIED) {
		denied.delete(denied.keys().next().value as string);
	}
}

/** Blocked attempts, newest first. */
export function listDenied(): { ip: string; lastSeen: number }[] {
	return [...denied].map(([ip, lastSeen]) => ({ ip, lastSeen })).reverse();
}
