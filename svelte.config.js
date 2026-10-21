import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html',
			precompress: true
		}),
		// Contracts the client and the Bun server must agree on, in one dependency-free
		// place both can import (shared/). The server reaches them by relative path,
		// since it never runs through Vite or svelte-kit.
		alias: {
			$shared: 'shared'
		}
	}
};

export default config;
