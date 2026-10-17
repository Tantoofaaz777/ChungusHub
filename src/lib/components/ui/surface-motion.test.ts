import { describe, expect, test } from 'bun:test';
import { scrimMotion, surfaceMotion } from './surface-motion';

function fixture() {
	const state = { appReduced: false, systemReduced: false };
	const node = { closest: () => state.appReduced ? {} : null, ownerDocument: { defaultView: {
		matchMedia: () => ({ matches: state.systemReduced }),
		getComputedStyle: () => ({ opacity: '0.8', transform: 'none' })
	} } } as unknown as HTMLElement;
	return { state, node };
}

describe('surface and central popup motion', () => {
	test('scrims fade without creating a fixed-child containing block', () => {
		const { node } = fixture(), motion = scrimMotion(node);
		expect(motion({ direction: 'in' }).css!(0, 1)).toBe('opacity: 0;');
		expect(motion({ direction: 'out' }).css!(1, 0)).toBe('opacity: 0.8;');
	});
	test('a popup inside a fading scrim moves without a second opacity animation', () => {
		const { node } = fixture(), motion = surfaceMotion(node, { fade: false });
		expect(motion().css!(0, 1)).toBe('transform:  translateY(8px);');
		expect(motion().css!(1, 0)).toBe('transform:  translateY(0px);');
	});
	test('each leg checks app and OS preferences and uses a shorter exit', () => {
		const { state, node } = fixture(), motion = surfaceMotion(node);
		expect(motion({ direction: 'in' }).duration).toBe(200);
		expect(motion({ direction: 'out' }).duration).toBe(140);
		state.appReduced = true; expect(motion({ direction: 'out' }).duration).toBe(0);
		state.appReduced = false; state.systemReduced = true;
		expect(motion({ direction: 'in' }).duration).toBe(0);
	});
});
