/**
 * What Settings → About states about this install, and the app's one outbound request that
 * no story asked for.
 *
 * Both live here rather than in the browser. The size of the data dir is a disk read only
 * this process can do, and the update check has to leave from the machine that would install
 * the update rather than from every phone that happens to open the page: one address asks
 * GitHub, not one per device, and a browser extension cannot quietly block it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, IMAGES_ROOT, IS_COMPILED } from './config';
import { APP_VERSION } from './version';
import { LATEST_RELEASE_API } from '../shared/project';

export interface InstallInfo {
	/** 'dev' from source, the baked number in a portable build (server/version.ts). */
	version: string;
	build: 'portable' | 'source';
	runtime: string;
	platform: string;
	dataDir: string;
	dataBytes: number;
	/** The share of `dataBytes` that is pictures: what makes a large folder readable. */
	imageBytes: number;
}

const PLATFORM_NAMES: Record<string, string> = {
	darwin: 'macOS',
	win32: 'Windows',
	linux: 'Linux'
};

/**
 * Total bytes under `dir`, walked entry by entry. Nothing is cached and nothing is
 * estimated: the page asks once when it opens, and the number is that moment's truth.
 * A walk that fails takes the whole answer with it rather than reporting a smaller
 * folder than the reader has.
 */
function dirBytes(dir: string): number {
	let total = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) total += dirBytes(path);
		else if (entry.isFile()) total += statSync(path).size;
	}
	return total;
}

export function installInfo(): InstallInfo {
	return {
		version: APP_VERSION,
		build: IS_COMPILED ? 'portable' : 'source',
		runtime: `Bun ${Bun.version}`,
		// An unmapped platform prints its own name rather than a guess: better a reader
		// reports "freebsd" than a row that quietly claims Linux.
		platform: `${PLATFORM_NAMES[process.platform] ?? process.platform} (${process.arch})`,
		dataDir: DATA_DIR,
		dataBytes: dirBytes(DATA_DIR),
		// The folder is minted by the first upload, so its absence is a library with no
		// pictures in it, not a fault.
		imageBytes: existsSync(IMAGES_ROOT) ? dirBytes(IMAGES_ROOT) : 0
	};
}

export interface LatestRelease {
	/** The tag with its leading `v` off, so the client can weigh it against its own number. */
	version: string;
	url: string;
}

/**
 * Asks GitHub what the newest release is. Called only when a reader presses the button on
 * the About page: nothing schedules this, nothing runs it at boot, and the page says so
 * before the press. It carries a bare product name as its user agent (GitHub rejects a
 * request with none) and nothing else, which is what lets that promise stand.
 *
 * Every failure is a sentence the reader gets to read. A check that quietly answered
 * "you are up to date" because the request died would be the one lie this page could tell.
 */
export async function latestRelease(fetcher: typeof fetch = fetch): Promise<LatestRelease> {
	const res = await fetcher(LATEST_RELEASE_API, {
		headers: { accept: 'application/vnd.github+json', 'user-agent': 'ChungusHub' },
		signal: AbortSignal.timeout(10_000)
	});
	// A 404 is the same answer for two states, so it names both: an unauthenticated request
	// cannot tell a repository with no release from one it is not allowed to see at all.
	if (res.status === 404) {
		throw new Error('GitHub has no stable server release to compare against, or the repository is not public. Android test APKs are released separately.');
	}
	if (res.status === 403 || res.status === 429) {
		throw new Error('GitHub is rate limiting this address. It clears within the hour.');
	}
	if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
	const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
	if (typeof data.tag_name !== 'string' || typeof data.html_url !== 'string') {
		throw new Error('GitHub answered with something this build cannot read.');
	}
	return { version: data.tag_name.replace(/^v/, ''), url: data.html_url };
}
