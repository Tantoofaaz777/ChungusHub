import type { Plugin } from 'vite';

interface BuildFile {
	type: string;
	fileName: string;
	isEntry?: boolean;
	isDynamicEntry?: boolean;
	facadeModuleId?: string | null;
	modules?: Record<string, unknown>;
	imports?: string[];
	viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
}

/** The home route, layout/error nodes and entry points, following static imports only. */
export function collectBootAssets(bundle: Record<string, BuildFile>): string[] {
	const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
	const home = chunks.find((chunk) => Object.keys(chunk.modules ?? {}).some((id) =>
		id.replaceAll('\\', '/').split('?')[0].endsWith('/src/routes/+page.svelte')));
	if (!home) throw new Error('Cannot find the home route in the client build for offline caching.');
	const roots = chunks.filter((chunk) => (chunk.isEntry && !chunk.isDynamicEntry) ||
		/\/nodes\/[01]\.js$/.test((chunk.facadeModuleId ?? '').replaceAll('\\', '/')));
	roots.push(home);
	const assets = new Set<string>();
	function visit(fileName: string): void {
		if (assets.has(fileName)) return;
		const file = bundle[fileName];
		if (!file) throw new Error(`Missing boot dependency: ${fileName}`);
		assets.add(fileName);
		for (const dependency of file.imports ?? []) visit(dependency);
		for (const css of file.viteMetadata?.importedCss ?? []) assets.add(css);
		for (const asset of file.viteMetadata?.importedAssets ?? []) assets.add(asset);
	}
	for (const root of roots) visit(root.fileName);
	return [...assets].sort().map((fileName) => `/${fileName}`);
}

/** Keep the offline shell complete without downloading every unopened panel at install. */
export function bootAssetManifest(): Plugin {
	return {
		name: 'chungus-boot-assets',
		apply: 'build',
		generateBundle(_options, bundle) {
			if (!Object.values(bundle).some((file) => file.type === 'chunk' && file.fileName.includes('/immutable/entry/'))) return;
			this.emitFile({ type: 'asset', fileName: '_app/boot-assets.json', source: JSON.stringify(collectBootAssets(bundle)) });
		}
	};
}
