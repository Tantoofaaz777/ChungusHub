import { describe, expect, test } from 'bun:test';
import { menuMotion } from './menu-motion';

function fixture() {
	const state = { appReduced: false, systemReduced: false, transform: 'none', opacity: '1' };
	const node = {
		closest: () => state.appReduced ? {} : null,
		ownerDocument: { defaultView: {
			matchMedia: () => ({ matches: state.systemReduced }),
			getComputedStyle: () => ({ transform: state.transform, opacity: state.opacity })
		} }
	} as unknown as HTMLElement;
	return { state, motion: menuMotion(node) };
}

describe('small menu motion', () => {
	test('closes faster than it opens, using only opacity and transform', () => {
		const { motion } = fixture();
		const opening = motion({ direction: 'in' }), closing = motion({ direction: 'out' });
		expect(opening.duration).toBe(160); expect(closing.duration).toBe(100);
		expect(opening.css!(0, 1)).toBe('opacity: 0; transform:  translateY(4px);');
		expect(opening.css!(1, 0)).toBe('opacity: 1; transform:  translateY(0px);');
		expect(opening.easing!(0.5)).toBeGreaterThan(0.5);
	});
	test('checks both reduction preferences for every leg, including a reversed transition', () => {
		const { state, motion } = fixture();
		expect(motion({ direction: 'in' }).duration).toBe(160);
		state.appReduced = true;
		expect(motion({ direction: 'out' }).duration).toBe(0);
		state.appReduced = false; state.systemReduced = true;
		expect(motion({ direction: 'in' }).duration).toBe(0);
		state.systemReduced = false;
		expect(motion({ direction: 'out' }).duration).toBe(100);
	});
	test('reversal keeps the original transform and opacity rather than capturing an animated frame', () => {
		const state = { transform: 'matrix(1, 0, 0, 1, 12, 0)', opacity: '0.8' };
		const node = { closest: () => null, ownerDocument: { defaultView: {
			getComputedStyle: () => ({ ...state }), matchMedia: () => ({ matches: false })
		} } } as unknown as HTMLElement;
		const motion = menuMotion(node);
		state.transform = 'matrix(1, 0, 0, 1, 12, 3)'; state.opacity = '0.3';
		expect(motion({ direction: 'out' }).css!(1, 0)).toBe('opacity: 0.8; transform: matrix(1, 0, 0, 1, 12, 0) translateY(0px);');
		expect(motion({ direction: 'in' }).css!(1, 0)).toBe('opacity: 0.8; transform: matrix(1, 0, 0, 1, 12, 0) translateY(0px);');
	});
});
