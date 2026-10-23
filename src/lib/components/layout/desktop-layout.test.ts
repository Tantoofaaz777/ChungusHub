import { describe, expect, test } from 'bun:test';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH, normalizeDesktopLayout, panelBounds } from './desktop-layout';

describe('desktop dock dimensions', () => {
	test('reserving a readable chat limits a dragged panel even at a narrower desktop width', () => {
		expect(panelBounds(964)).toEqual({ min: 300, max: 564 });
		expect(clampPanelWidth(900, 964)).toBe(564);
		expect(clampPanelWidth(100, 964)).toBe(300);
		expect(clampPanelWidth(477.7, 964)).toBe(478);
	});
	test('shrinking and restoring the window does not erase the preferred panel width', () => {
		const saved = normalizeDesktopLayout({ side: 'right', panelWidth: 720 });
		expect(clampPanelWidth(saved.panelWidth, 1000)).toBe(600);
		expect(clampPanelWidth(saved.panelWidth, 1600)).toBe(720);
		expect(saved).toEqual({ side: 'right', panelWidth: 720 });
	});
	test('transient zero-sized or very small hosts produce valid non-negative bounds', () => {
		for (const size of [0, 300, 450, 600]) {
			const { min, max } = panelBounds(size);
			const width = clampPanelWidth(DEFAULT_PANEL_WIDTH, size);
			expect(width).toBeGreaterThanOrEqual(min);
			expect(width).toBeLessThanOrEqual(max);
		}
	});
	test('corrupt or obsolete device preferences use a safe default', () => {
		for (const raw of [null, 'bad', { panelWidth: NaN }, { side: 'top', panelWidth: '700' }]) {
			expect(normalizeDesktopLayout(raw)).toEqual({ side: 'left', panelWidth: DEFAULT_PANEL_WIDTH });
		}
		expect(normalizeDesktopLayout({ side: 'right', panelWidth: -1 })).toEqual({ side: 'right', panelWidth: 300 });
		expect(normalizeDesktopLayout({ panelWidth: 99999 }).panelWidth).toBe(960);
	});
});
