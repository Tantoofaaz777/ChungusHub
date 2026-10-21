import { expect, test } from 'bun:test';
import { collectBootAssets } from './boot-assets';

test('offline boot graph follows static dependencies and styles, leaving unopened panels out', () => {
	const bundle = {
		'entry.js': { type: 'chunk', fileName: 'entry.js', isEntry: true, imports: ['shared.js'] },
		'home.js': {
			type: 'chunk', fileName: 'home.js', isDynamicEntry: true,
			modules: { 'C:\\app\\src\\routes\\+page.svelte?compiled': {} }, imports: ['shared.js'],
			viteMetadata: { importedCss: new Set(['home.css']), importedAssets: new Set(['logo.svg']) }
		},
		'layout.js': { type: 'chunk', fileName: 'layout.js', facadeModuleId: '/app/.svelte-kit/generated/client/nodes/0.js' },
		'error.js': { type: 'chunk', fileName: 'error.js', facadeModuleId: '/app/.svelte-kit/generated/client/nodes/1.js' },
		'shared.js': { type: 'chunk', fileName: 'shared.js', imports: ['entry.js'] },
		'panel.js': { type: 'chunk', fileName: 'panel.js', isEntry: true, isDynamicEntry: true }
	};
	expect(collectBootAssets(bundle)).toEqual(['/entry.js', '/error.js', '/home.css', '/home.js', '/layout.js', '/logo.svg', '/shared.js']);
});

test('an incomplete build cannot install an offline shell that silently misses the home route', () => {
	expect(() => collectBootAssets({})).toThrow('home route');
});
