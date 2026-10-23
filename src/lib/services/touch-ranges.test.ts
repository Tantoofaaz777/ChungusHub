import { describe, expect, test } from 'bun:test';
import { protectTouchRanges } from './touch-ranges';

/** Event bus for policy/lifecycle tests. Real range sanitization, hit testing and browser
 * scrolling are exercised separately with trusted CDP touch input in production Brave. */
function fixture() {
	const win = Object.assign(new EventTarget(), { getComputedStyle: (_node: unknown, pseudo?: string) =>
		pseudo ? { width: '16px' } : { direction: 'ltr' } });
	const doc = Object.assign(new EventTarget(), { defaultView: win });
	const node = {
		nodeName: 'INPUT', type: 'range', value: '20', min: '0', max: '100', offsetWidth: 116,
		disabled: false, isConnected: true, focus() {},
		getBoundingClientRect: () => ({ left: 0, width: 116 }),
		get valueAsNumber() { return Number(this.value); },
		set valueAsNumber(value: number) { this.value = String(value); },
		dispatchEvent(event: Event) {
			Object.defineProperty(event, 'composedPath', { value: () => [node, doc] });
			return doc.dispatchEvent(event);
		}
	};
	const cleanup = protectTouchRanges(doc as unknown as Document);
	const inputs: string[] = [], changes: string[] = [];
	doc.addEventListener('input', () => inputs.push(node.value));
	doc.addEventListener('change', () => changes.push(node.value));
	function pointer(type: string, x = 28, y = 0, extra: Record<string, unknown> = {}) {
		const event = new Event(type, { cancelable: true });
		Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, ...extra });
		Object.defineProperty(event, 'composedPath', { value: () => [node, doc] });
		doc.dispatchEvent(event);
		return event;
	}
	return { doc, win, node, cleanup, inputs, changes, pointer };
}

describe('shared touch range protection', () => {
	test('touch down and jitter do not publish a value; a tap commits once on release', () => {
		const f = fixture();
		expect(f.pointer('pointerdown', 58).defaultPrevented).toBe(true);
		f.pointer('pointermove', 61, 2);
		expect(f.inputs).toEqual([]);
		expect(f.node.value).toBe('20');
		f.pointer('pointerup', 58);
		expect(f.inputs).toEqual(['50']);
		expect(f.changes).toEqual(['50']);
		f.cleanup();
	});

	test('native input cannot reach persistent handlers while the gesture is undecided', () => {
		const f = fixture(); f.pointer('pointerdown');
		f.node.value = '99'; f.node.dispatchEvent(new Event('input'));
		expect(f.inputs).toEqual([]); expect(f.node.value).toBe('20');
		f.node.value = '88'; f.node.dispatchEvent(new Event('change'));
		expect(f.changes).toEqual([]); expect(f.node.value).toBe('20');
		f.pointer('pointercancel'); f.cleanup();
	});

	test('vertical intent stays scrolling even if the finger later moves horizontally', () => {
		const f = fixture(); f.pointer('pointerdown');
		expect(f.pointer('pointermove', 30, 18).defaultPrevented).toBe(false);
		f.pointer('pointermove', 100, 20); f.pointer('pointerup', 100, 20);
		expect(f.node.value).toBe('20'); expect(f.inputs).toEqual([]); expect(f.changes).toEqual([]);
		f.cleanup();
	});

	test('an ambiguous diagonal or a gesture returning to its start is not treated as a tap', () => {
		const f = fixture(); f.pointer('pointerdown');
		f.pointer('pointermove', 41, 12); f.pointer('pointerup', 28, 0);
		expect(f.inputs).toEqual([]); f.cleanup();
	});

	test('horizontal intent previews live and finishes with one change event', () => {
		const f = fixture(); f.pointer('pointerdown'); f.pointer('pointermove', 58, 1);
		expect(f.inputs).toEqual(['50']);
		f.pointer('pointerup', 78, 1);
		expect(f.node.value).toBe('70'); expect(f.changes).toEqual(['70']); f.cleanup();
	});

	for (const abort of ['pointercancel', 'lostpointercapture', 'blur', 'pagehide']) {
		test(`${abort} restores a cancelled preview instead of leaving a persisted accidental value`, () => {
			const f = fixture(); f.pointer('pointerdown'); f.pointer('pointermove', 58, 1);
			if (abort === 'blur' || abort === 'pagehide') f.win.dispatchEvent(new Event(abort));
			else f.pointer(abort);
			f.pointer('pointerup', 90);
			expect(f.inputs).toEqual(['50', '20']); expect(f.changes).toEqual([]); expect(f.node.value).toBe('20');
			f.cleanup();
		});
	}

	test('adding a second touch cancels the first rather than adjusting during a pinch', () => {
		const f = fixture(); f.pointer('pointerdown'); f.pointer('pointermove', 58, 1);
		f.pointer('pointerdown', 80, 0, { pointerId: 2, isPrimary: false });
		f.pointer('pointerup', 90); expect(f.node.value).toBe('20'); expect(f.changes).toEqual([]); f.cleanup();
	});

	test('scrolling the containing panel prevents a pending contact from committing', () => {
		const f = fixture(); f.pointer('pointerdown', 58); f.doc.dispatchEvent(new Event('scroll'));
		f.pointer('pointerup', 58); expect(f.inputs).toEqual([]); f.cleanup();
	});

	test('mouse and pen pointer handlers, ordinary input and keyboard updates pass through', () => {
		const f = fixture();
		expect(f.pointer('pointerdown', 58, 0, { pointerType: 'mouse' }).defaultPrevented).toBe(false);
		expect(f.pointer('pointerdown', 58, 0, { pointerType: 'pen' }).defaultPrevented).toBe(false);
		f.node.value = '21'; f.node.dispatchEvent(new Event('input'));
		expect(f.inputs).toEqual(['21']); f.cleanup();
	});

	test('disabled ranges and other input types retain their native behavior', () => {
		const f = fixture(); f.node.disabled = true;
		expect(f.pointer('pointerdown').defaultPrevented).toBe(false);
		f.node.disabled = false; f.node.type = 'text';
		expect(f.pointer('pointerdown').defaultPrevented).toBe(false);
		expect(f.inputs).toEqual([]); f.cleanup();
	});

	test('disconnecting a range during a gesture never writes to its detached handlers', () => {
		const f = fixture(); f.pointer('pointerdown'); f.node.isConnected = false; f.pointer('pointerup', 58);
		expect(f.inputs).toEqual([]); f.cleanup();
	});

	test('touch compatibility clicks cannot trigger desktop reset; a subsequent real mouse click can', () => {
		const f = fixture(); f.pointer('pointerdown'); f.pointer('pointerup');
		expect(f.pointer('click', 28).defaultPrevented).toBe(true);
		expect(f.pointer('dblclick', 28).defaultPrevented).toBe(true);
		f.pointer('pointerdown', 28, 0, { pointerType: 'mouse' });
		expect(f.pointer('dblclick', 28, 0, { pointerType: 'mouse' }).defaultPrevented).toBe(false);
		f.cleanup();
	});

	test('cleanup removes the policy and an absent document window is harmless', () => {
		const f = fixture(); f.cleanup();
		expect(f.pointer('pointerdown', 58).defaultPrevented).toBe(false);
		expect(() => protectTouchRanges({ defaultView: null } as Document)()).not.toThrow();
	});
});
