/**
 * What retention keeps, as a pure decision over a list. The thinning is what makes "go back
 * to last spring" affordable, so its edges are worth pinning: pinned and manual snapshots
 * are never touched, the recent window is kept whole, and everything older collapses to one
 * a week and then one a month.
 */
import { describe, test, expect } from 'bun:test';
import { prunable } from './retention';
import { DEFAULT_BACKUP_SETTINGS, type SnapshotKind, type SnapshotManifest } from '../../shared/backups';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

function snap(id: string, kind: SnapshotKind, daysAgo: number, pinned = false): SnapshotManifest {
	return {
		id,
		createdAt: NOW - daysAgo * DAY,
		kind,
		label: null,
		pinned,
		appVersion: 'test',
		schemaVersion: 35,
		summary: { chats: 0, messages: 0, characters: 0, personas: 0, lorebooks: 0, presets: 0, images: 0 },
		bytes: { logical: 0, onDisk: 0 },
		fileCount: 0,
		linked: true,
		warnings: []
	};
}

const settings = { ...DEFAULT_BACKUP_SETTINGS, keepScheduled: 3, keepUpgrade: 2 };

describe('retention', () => {
	test('keeps the recent scheduled window whole', () => {
		const list = [0, 1, 2, 3].map((d) => snap(`s${d}`, 'scheduled', d));
		const doomed = prunable(list, settings, NOW);
		expect(doomed).not.toContain('s0');
		expect(doomed).not.toContain('s1');
		expect(doomed).not.toContain('s2');
	});

	test('thins older scheduled snapshots to one a week', () => {
		const recent = [0, 1, 2].map((d) => snap(`recent${d}`, 'scheduled', d));
		// Four in one week, well past the recent window: one survives.
		const week = [20, 21, 22, 23].map((d) => snap(`w${d}`, 'scheduled', d));
		const doomed = prunable([...recent, ...week], settings, NOW);
		const survivors = week.filter((s) => !doomed.includes(s.id));
		expect(survivors).toHaveLength(1);
		// The newest of the group, so the kept point is the closest to the boundary.
		expect(survivors[0].id).toBe('w20');
	});

	test('drops scheduled snapshots older than a year', () => {
		const recent = [0, 1, 2].map((d) => snap(`recent${d}`, 'scheduled', d));
		const doomed = prunable(
			[...recent, snap('ancient', 'scheduled', 400), snap('old', 'scheduled', 300)],
			settings,
			NOW
		);
		expect(doomed).toContain('ancient');
		expect(doomed).not.toContain('old');
	});

	test('the recent window holds even when every snapshot is ancient', () => {
		// Someone who did not open the app for two years has three snapshots, all old. They
		// are also all the history there is, so thinning must not reach them.
		const list = [700, 730, 760].map((d) => snap(`s${d}`, 'scheduled', d));
		expect(prunable(list, settings, NOW)).toEqual([]);
	});

	test('never prunes a manual snapshot', () => {
		const list = [0, 100, 500, 900].map((d) => snap(`m${d}`, 'manual', d));
		expect(prunable(list, settings, NOW)).toEqual([]);
	});

	test('never prunes imported restore points or lets their clock freeze local thinning', () => {
		const imported = snap('foreign', 'imported', -30);
		const scheduled = [0, 1, 2, 20, 21, 400].map((d) => snap(`s${d}`, 'scheduled', d));
		const doomed = prunable([imported, ...scheduled], settings, NOW);
		expect(doomed).not.toContain('foreign');
		expect(doomed).toContain('s400');
	});

	test('never prunes a pinned snapshot, whatever its kind', () => {
		const list = [
			snap('keep-me', 'scheduled', 900, true),
			snap('pinned-upgrade', 'preUpgrade', 900, true),
			...[1, 2, 3, 4].map((d) => snap(`u${d}`, 'preUpgrade', d))
		];
		const doomed = prunable(list, settings, NOW);
		expect(doomed).not.toContain('keep-me');
		expect(doomed).not.toContain('pinned-upgrade');
	});

	test('caps before-upgrade snapshots at the configured count', () => {
		const list = [1, 2, 3, 4, 5].map((d) => snap(`u${d}`, 'preUpgrade', d));
		const doomed = prunable(list, settings, NOW);
		// keepUpgrade is 2: the two newest stay.
		expect(doomed).toEqual(['u3', 'u4', 'u5']);
	});

	test('caps before-restore snapshots without a setting', () => {
		const list = Array.from({ length: 8 }, (_, i) => snap(`r${i}`, 'preRestore', i));
		const doomed = prunable(list, settings, NOW);
		expect(doomed).toEqual(['r5', 'r6', 'r7']);
	});

	test('a clock behind the store does not age anything out', () => {
		// A dead battery or a first boot before any time sync reads every snapshot as older
		// than a year, and the boot prune would empty the timeline over a wrong date.
		const list = [0, 1, 2, 20, 21, 400].map((d) => snap(`s${d}`, 'scheduled', d));
		expect(prunable(list, settings, NOW - 10 * DAY)).toEqual([]);
		// The count-based caps need no clock, so they still hold.
		const upgrades = [1, 2, 3].map((d) => snap(`u${d}`, 'preUpgrade', d));
		expect(prunable([...list, ...upgrades], settings, NOW - 10 * DAY)).toEqual(['u3']);
	});

	test('a bad keepScheduled cannot empty the store', () => {
		const list = [0, 1, 2].map((d) => snap(`s${d}`, 'scheduled', d));
		const doomed = prunable(list, { ...settings, keepScheduled: 0 }, NOW);
		expect(doomed).not.toContain('s0');
	});
});
