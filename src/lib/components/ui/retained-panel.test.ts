import { describe, expect, test } from 'bun:test';
import { retainedPanel } from './retained-panel';

function fixture({ appReduced = false, systemReduced = false, supported = true } = {}) {
	const state = { appReduced, systemReduced, paint: { opacity: '1', transform: 'none' } };
	const attrs = new Map<string, string>();
	const animations: { frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; finish: () => void }[] = [];
	const node = {
		hidden: true, inert: true, scrollTop: 321,
		closest: () => state.appReduced ? {} : null,
		setAttribute: (name: string, value: string) => attrs.set(name, value),
		ownerDocument: { defaultView: {
			matchMedia: () => ({ matches: state.systemReduced }),
			getComputedStyle: () => ({ ...state.paint })
		} },
		animate: supported ? (frames: Keyframe[], options: KeyframeAnimationOptions) => {
			let finish!: () => void;
			const finished = new Promise<void>(resolve => { finish = resolve; });
			const animation = { frames, options, cancelled: false, finish };
			animations.push(animation);
			return { finished, cancel: () => { animation.cancelled = true; } };
		} : undefined
	} as unknown as HTMLElement;
	const action = retainedPanel(node, false)!;
	return { state, attrs, animations, node, open: () => action.update!(true), close: () => action.update!(false), destroy: () => action.destroy!() };
}

describe('retained panel motion lifecycle', () => {
	test('starts hidden without allocating an animation; blocks input before the exit finishes', async () => {
		const f = fixture();
		expect(f.node.hidden).toBe(true); expect(f.animations).toHaveLength(0);
		f.open(); expect(f.node.hidden).toBe(false); expect(f.node.inert).toBe(false);
		f.animations[0].finish(); await Promise.resolve();
		expect(f.animations[0].cancelled).toBe(true);
		f.close();
		expect(f.node.hidden).toBe(false); expect(f.node.inert).toBe(true); expect(f.attrs.get('aria-hidden')).toBe('true');
		expect(f.animations[1].options.duration).toBe(140);
		f.animations[1].finish(); await Promise.resolve();
		expect(f.node.hidden).toBe(true); expect(f.node.scrollTop).toBe(321);
		f.destroy();
	});
	test('reopening samples the current painted frame and rejects an old closing completion', async () => {
		const f = fixture();
		f.open(); f.animations[0].finish(); await Promise.resolve(); f.close();
		f.state.paint = { opacity: '0.35', transform: 'matrix(1, 0, 0, 1, 0, 5)' };
		f.open();
		expect(f.animations[1].cancelled).toBe(true);
		expect(f.animations[2].frames[0]).toEqual(f.state.paint);
		f.animations[1].finish(); await Promise.resolve();
		expect(f.node.hidden).toBe(false); expect(f.node.inert).toBe(false);
		f.animations[2].finish(); await Promise.resolve();
		expect(f.node.hidden).toBe(false); expect(f.animations[2].cancelled).toBe(true);
		f.destroy();
	});
	test('a late opening completion cannot undo a close', async () => {
		const f = fixture(); f.open(); f.close();
		f.animations[1].finish(); await Promise.resolve();
		f.animations[0].finish(); await Promise.resolve();
		expect(f.node.hidden).toBe(true); expect(f.node.inert).toBe(true);
		f.destroy();
	});
	test('app and OS reduced motion hide immediately without waiting for finish events', () => {
		for (const options of [{ appReduced: true }, { systemReduced: true }, { supported: false }]) {
			const f = fixture(options); f.open();
			expect(f.node.hidden).toBe(false); f.close();
			expect(f.node.hidden).toBe(true); expect(f.node.inert).toBe(true); expect(f.animations).toHaveLength(0);
			f.destroy();
		}
	});
	test('a changed reduction preference cancels a running animation before hiding', async () => {
		const f = fixture(); f.open(); f.state.systemReduced = true; f.close();
		expect(f.animations).toHaveLength(1); expect(f.animations[0].cancelled).toBe(true);
		expect(f.node.hidden).toBe(true);
		f.animations[0].finish(); await Promise.resolve(); expect(f.node.hidden).toBe(true);
		f.destroy();
	});
	test('unchanged activity does not restart motion, and disposal rejects pending callbacks', async () => {
		const f = fixture(); f.open(); f.open(); expect(f.animations).toHaveLength(1);
		f.destroy(); f.node.hidden = true; f.animations[0].finish(); await Promise.resolve();
		expect(f.node.hidden).toBe(true); expect(f.animations[0].cancelled).toBe(true);
		f.open(); expect(f.animations).toHaveLength(1);
	});
});
