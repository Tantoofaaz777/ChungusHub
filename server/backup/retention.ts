/**
 * Which snapshots survive.
 *
 * Two ideas, and the split is the point. A snapshot taken because something was ABOUT to
 * happen (an upgrade, a restore) or because a person asked for one is evidence, and
 * evidence is not thinned on a timer. A scheduled snapshot is a position on a timeline, and
 * a timeline needs recent detail far more than it needs every point on it, so past the
 * recent window they thin to one a week, then one a month, then stop.
 *
 * That thinning is what makes "go back to last spring" a real answer rather than a slogan:
 * roughly thirty scheduled snapshots cover a year, and hardlinking means the images in them
 * are stored once.
 */
import type { BackupSettings, SnapshotManifest } from '../../shared/backups';
import { THIN_MONTHLY_MONTHS, THIN_WEEKLY_WEEKS } from '../../shared/backups';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** Before-restore snapshots kept. Fixed rather than configurable: they exist for the
 *  minutes after a restore that went somewhere unexpected, not as history. */
const KEEP_PRE_RESTORE = 5;

function monthKey(at: number): string {
	const d = new Date(at);
	return `${d.getFullYear()}-${d.getMonth()}`;
}

/**
 * Absolute week buckets rather than "weeks ago", so a snapshot does not change bucket
 * between two runs of this function and get re-picked as the survivor of a different week.
 */
function weekKey(at: number): number {
	return Math.floor(at / WEEK);
}

/** The ids retention would delete, newest-first order preserved for the caller's log. */
export function prunable(snapshots: SnapshotManifest[], settings: BackupSettings, now: number): string[] {
	const doomed: string[] = [];
	const byKind = (kind: SnapshotManifest['kind']) =>
		snapshots
			.filter((s) => s.kind === kind && !s.pinned)
			.sort((a, b) => b.createdAt - a.createdAt);

	// A person asked for these. Nothing automatic removes them.
	//   manual: kept forever.

	for (const doomedByCount of [
		byKind('preUpgrade').slice(Math.max(1, settings.keepUpgrade)),
		byKind('preRestore').slice(KEEP_PRE_RESTORE)
	]) {
		for (const s of doomedByCount) doomed.push(s.id);
	}

	const scheduled = byKind('scheduled');
	const recent = Math.max(1, settings.keepScheduled);
	const olderThanRecent = scheduled.slice(recent);

	// Everything below reads an AGE, and an age is only as good as the clock that produced it.
	// A machine whose clock sits behind its own store (a dead battery, a first boot before any
	// time sync) would read every snapshot as more than a year old and empty the timeline in
	// one pass at boot, which is data loss caused by a wrong date. The count-based caps above
	// need no clock and stand; this half stands down until the two agree again.
	// Imported rows are portable restore points, not positions on this installation's
	// timeline. A source machine with a future clock must not freeze local retention.
	const newest = snapshots
		.filter((snapshot) => snapshot.kind !== 'imported')
		.reduce((max, snapshot) => Math.max(max, snapshot.createdAt), 0);
	if (now < newest) return doomed;

	const weeklyWindow = THIN_WEEKLY_WEEKS * WEEK;
	const monthlyWindow = THIN_MONTHLY_MONTHS * 30 * DAY;
	const keptWeeks = new Set<number>();
	const keptMonths = new Set<string>();

	for (const snapshot of olderThanRecent) {
		const age = now - snapshot.createdAt;
		if (age > monthlyWindow) {
			doomed.push(snapshot.id);
			continue;
		}
		// Newest first, so the first snapshot seen in a bucket is the one worth keeping.
		if (age <= weeklyWindow) {
			const key = weekKey(snapshot.createdAt);
			if (keptWeeks.has(key)) doomed.push(snapshot.id);
			else keptWeeks.add(key);
			continue;
		}
		const key = monthKey(snapshot.createdAt);
		if (keptMonths.has(key)) doomed.push(snapshot.id);
		else keptMonths.add(key);
	}

	return doomed;
}
