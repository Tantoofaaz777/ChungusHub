/**
 * Message timestamp + duration formatting (Settings → Chat → Message Details).
 *
 * Everything in words comes from the browser's locale, never a hardcoded one: this app
 * is used in languages other than English, and an en-US month sitting beside prose in
 * another language reads as a bug. `clock` only overrides the locale's own 12/24-hour habit when
 * the user explicitly asks it to. The numeric date is the one exception and goes the
 * other way: it is ISO app-wide through `utils/date.ts`, because a locale's own digit
 * order is precisely what a reader from elsewhere cannot decode.
 *
 * Relative labels go stale where absolute ones don't, so this module owns ONE 30s
 * tick that every meta row can read instead of each message holding an interval.
 * The write is unconditional; a row formatting absolutely never reads `now`, so it
 * has no subscribers there and costs nothing.
 */
import type { ClockFormat, TimestampFormat } from '#lib/types/theme.ts';
import { formatDate } from '#lib/utils/date.ts';

let tick = $state(Date.now());

if (typeof window !== 'undefined') {
	setInterval(() => (tick = Date.now()), 30_000);
}

/** Reactive "now" at 30s resolution: read it to keep a relative label honest. */
export const relativeClock = {
	get now() {
		return tick;
	}
};

/** [upper bound of this unit in ms, the unit, ms per unit]. First match wins. */
const RELATIVE_STEPS: [number, Intl.RelativeTimeFormatUnit, number][] = [
	[60_000, 'second', 1_000],
	[3_600_000, 'minute', 60_000],
	[86_400_000, 'hour', 3_600_000],
	[604_800_000, 'day', 86_400_000],
	[2_592_000_000, 'week', 604_800_000],
	[31_536_000_000, 'month', 2_592_000_000]
];

let relativeFormatter: Intl.RelativeTimeFormat | null = null;

/** Lazy so construction can't run at import time in a non-browser test process. */
function relative(): Intl.RelativeTimeFormat {
	return (relativeFormatter ??= new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }));
}

function formatRelative(ts: number, now: number): string {
	const diff = ts - now;
	const abs = Math.abs(diff);
	// Under the tick resolution there is nothing honest to say but "now".
	if (abs < 45_000) return relative().format(0, 'second');
	for (const [limit, unit, ms] of RELATIVE_STEPS) {
		if (abs < limit) return relative().format(Math.round(diff / ms), unit);
	}
	return relative().format(Math.round(diff / 31_536_000_000), 'year');
}

/**
 * A message timestamp in the user's chosen shape. `now` is only read by the
 * relative format. Pass `relativeClock.now` from a reactive context so the label
 * refreshes; any value works for the absolute formats.
 */
export function formatMessageTime(
	ts: number,
	format: TimestampFormat,
	clock: ClockFormat,
	now: number
): string {
	if (format === 'relative') return formatRelative(ts, now);

	// undefined = defer to the locale; only an explicit pick overrides it.
	const hour12 = clock === 'auto' ? undefined : clock === '12';
	const date = new Date(ts);
	const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 });

	// The two absolute shapes split on exactly the ambiguity: 'short' is the numeric one,
	// so it takes the app's ISO date, while 'full' spells the month out, which no locale
	// can make ambiguous and which is the whole reason that pill exists.
	if (format === 'short') return `${formatDate(ts)} ${time}`;

	const day = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
	return `${day} ${time}`;
}

/** Generation duration, shown under a portrait or in the meta row. */
export function formatDuration(ms: number): string {
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(1)}s`;
	return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
}
