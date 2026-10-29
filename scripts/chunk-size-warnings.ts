import { Buffer } from 'node:buffer';
import type { Plugin } from 'vite';

interface BuildFile {
	type: string;
	fileName: string;
	code?: string;
	modules?: Record<string, unknown>;
}

const APPLICATION_LIMIT_KB = 500;
// These lazy vocabulary payloads are currently about 951 and 2,014 kB. Keep finite
// budgets so an unexpected increase still warns, without treating their data as app code.
const VOCABULARY_LIMITS = { cl100k_base: 1100, o200k_base: 2300 } as const;

function vocabularyBudget(ids: string[]): number | null {
	if (!ids.length || ids.some(id => !id.includes('/node_modules/gpt-tokenizer/'))) return null;
	const families = Object.keys(VOCABULARY_LIMITS).filter(family =>
		ids.some(id => id.endsWith(`/encoding/${family}.js`)));
	// Mixed application code or merged vocabularies must retain the normal warning.
	return families.length === 1 ? VOCABULARY_LIMITS[families[0] as keyof typeof VOCABULARY_LIMITS] : null;
}

export function oversizedChunks(bundle: Record<string, BuildFile>) {
	return Object.values(bundle).flatMap(file => {
		if (file.type !== 'chunk' || typeof file.code !== 'string') return [];
		const ids = Object.keys(file.modules ?? {}).map(id => id.replaceAll('\\', '/').split('?')[0]);
		const vocabularyLimit = vocabularyBudget(ids);
		const limitKB = vocabularyLimit ?? APPLICATION_LIMIT_KB;
		const sizeKB = Buffer.byteLength(file.code, 'utf8') / 1000;
		return sizeKB > limitKB ? [{ fileName: file.fileName, sizeKB, limitKB, vocabulary: vocabularyLimit !== null }] : [];
	});
}

/** Replace Vite's single generic chunk threshold with per-payload budgets only.
 * All other build warnings and errors keep their normal path. */
export function chunkSizeWarnings(): Plugin {
	let minified = true;
	return {
		name: 'chungus-chunk-size-warnings',
		apply: 'build',
		config() { return { build: { chunkSizeWarningLimit: Number.POSITIVE_INFINITY } }; },
		configResolved(config) { minified = Boolean(config.build.minify); },
		generateBundle(_options, bundle) {
			// SvelteKit also builds the server and service worker. Match the client
			// entry graph, just like the offline boot manifest, rather than warning on those.
			if (!minified || !Object.values(bundle).some(file => file.type === 'chunk' && file.fileName.includes('/immutable/entry/'))) return;
			for (const chunk of oversizedChunks(bundle)) {
				this.warn(`${chunk.vocabulary ? 'Tokenizer vocabulary' : 'Application JavaScript'} exceeds its size budget: ${chunk.fileName} (${chunk.sizeKB.toFixed(2)} kB; budget ${chunk.limitKB} kB).`);
			}
		}
	};
}
