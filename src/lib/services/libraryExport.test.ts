import { expect, spyOn, test } from 'bun:test';
import { triggerDownload } from './libraryExport';

for (const clickFails of [false, true]) {
	test(`a browser download keeps its URL available until consumption starts (click fails: ${clickFails})`, () => {
		const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
		const events: string[] = [];
		const anchor = { href: '', download: '', click() {
			events.push('click'); if (clickFails) throw new Error('click failed');
		}, remove() { events.push('remove'); } };
		Object.defineProperty(globalThis, 'document', { configurable: true, value: {
			createElement: () => anchor, body: { appendChild: () => events.push('append') }
		} });
		const create = spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
		const revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		let cleanup: (() => void) | undefined, delay: number | undefined;
		const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
			cleanup = fn; delay = ms; return 1;
		}) as typeof setTimeout);
		try {
			const start = () => triggerDownload('card.json', new Blob(['{}']));
			if (clickFails) expect(start).toThrow('click failed'); else start();
			expect(events).toEqual(['append', 'click', 'remove']);
			expect(anchor.href).toBe('blob:export'); expect(anchor.download).toBe('card.json');
			expect(revoke).not.toHaveBeenCalled(); expect(delay).toBe(60_000);
			cleanup!(); expect(revoke).toHaveBeenCalledWith('blob:export');
		} finally {
			create.mockRestore(); revoke.mockRestore(); timer.mockRestore();
			if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
			else Reflect.deleteProperty(globalThis, 'document');
		}
	});
}
