/** Security floor shared by startup and portable packaging. */
export const MINIMUM_BUN_VERSION = '1.4.4';

export function unsupportedBunReason(version: string | undefined): string | null {
	// Require a stable release. Build metadata is allowed; canary/prerelease builds
	// do not establish that the minimum security fix is present.
	const match = version?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i);
	const current = match?.slice(1, 4).map(Number);
	const minimum = MINIMUM_BUN_VERSION.split('.').map(Number);
	if (current?.every(Number.isSafeInteger)) {
		for (let i = 0; i < minimum.length; i++) {
			if (current[i] > minimum[i]) return null;
			if (current[i] < minimum[i]) break;
			if (i === minimum.length - 1) return null;
		}
	}
	return [
		`ChungusHub requires stable Bun ${MINIMUM_BUN_VERSION} or newer; detected ${version ? `Bun ${version}` : 'a runtime other than Bun'}.`,
		'Earlier Bun versions are affected by CVE-2026-111497.',
		'Update the Bun executable used by your service or launcher, then restart. Portable servers must be rebuilt with the corrected Bun runtime.'
	].join('\n');
}
