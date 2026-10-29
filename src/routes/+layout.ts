// The Bun server serves adapter-static's index.html fallback for app routes.
// With SSR disabled, prerendering would duplicate that shell before the adapter replaces it.
export const ssr = false;
export const prerender = false;
