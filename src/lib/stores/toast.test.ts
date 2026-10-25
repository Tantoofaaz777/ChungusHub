import { afterEach, expect, test } from 'bun:test';

const identity = <T>(value: T) => value;
(globalThis as any).$state = identity;
const { toastStore } = await import('./toast.svelte');
const store = new (toastStore.constructor as { new(): typeof toastStore })();
afterEach(() => { for (const toast of [...store.toasts]) store.remove(toast.id); });

test('optional navigation keeps separate destinations and updates folded callbacks', () => {
	let opened = '';
	store.info('Create a memory', { key: 'a', label: 'Open Chat Memory', open: () => { opened = 'old'; } });
	store.info('Create a memory', { key: 'b', label: 'Open Chat Memory', open: () => { opened = 'b'; } });
	store.info('Create a memory', { key: 'a', label: 'Open Chat Memory', open: () => { opened = 'new'; } });
	store.info('Create a memory');
	expect(store.toasts).toHaveLength(3);
	expect(store.toasts[0].count).toBe(2);
	store.toasts[0].link?.open(); expect(opened).toBe('new');
	store.toasts[1].link?.open(); expect(opened).toBe('b');
	expect(store.toasts[2].link).toBeUndefined();
});
