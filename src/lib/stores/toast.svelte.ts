/**
 * The transient channel of the app's notification contract, and the queue behind the toast
 * stack. The contract itself is four channels, picked by one question: does the reader have
 * to do something about it?
 *
 *   nothing   The screen already says it. A row that vanished, a star that lit, an editor that
 *             closed. This is the DEFAULT answer, and the reason most acts notify nothing at
 *             all: a line repeating what is already on screen only teaches the eye to skip the
 *             corner where the failures land.
 *   toast     Something happened the screen does NOT show, and no answer is needed. A count the
 *             reader cannot see, work that landed off-screen, a consequence somewhere else.
 *   in place  A failure belongs where the act was: the dialog that raised it, the field that
 *             refused it. That is `ui/Alert.svelte`, never this queue: a toast fired from
 *             inside a dialog is a message the reader cannot reach.
 *   standing  A condition rather than an event (no connection, work not on disk). It lasts as
 *             long as it is true, so it can never be a toast, which leaves while it still is.
 *
 * Wording, so 100+ call sites read as one voice:
 *   - `failed(act, cause)` is the ONLY door a thrown error takes to the screen. The thrown text
 *     names a symptom ("429 rate_limit_exceeded"); only the call site knows which of the
 *     reader's clicks produced it, and a reason without its act is unusable.
 *   - `error(message)` is for a sentence you wrote yourself: a validation, a refusal.
 *   - Name things in quotes, state real counts, never "some" or "a few".
 *   - No em dash, ever. Two clauses are two sentences, or a colon.
 *   - One sentence carries no trailing period; two or more keep theirs.
 *   - Durations are a property of the tone, not of the sentence, so they are not a parameter.
 *   - A toast may offer an optional navigation shortcut. Anything that needs an answer is asked BEFORE the act
 *     (the destructive-act ladder in architecture/ui-shell-settings.md), never offered as
 *     an undo afterwards: a decision on a 5 second timer is a bug generator, not a safety.
 */

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastLink {
	/** Identifies the destination when folding otherwise identical notifications. */
	key: string;
	label: string;
	open: () => void;
}

export interface Toast {
	id: string;
	message: string;
	tone: ToastTone;
	/** Repeats of an identical line fold into the live one instead of stacking twins. */
	count: number;
	link?: ToastLink;
}

/** How long each tone is worth reading. Held here rather than at the call sites so a sentence
 *  cannot quietly buy itself a longer stay than its severity earns. */
const DURATION: Record<ToastTone, number> = {
	success: 3000,
	info: 4000,
	warning: 5000,
	error: 7000
};

/** More than this on screen is a wall rather than a message, so the oldest makes room. */
const MAX_VISIBLE = 3;

/** An embedded reason past this is a stack trace or a page of provider JSON, and neither is
 *  something the reader can act on. */
const REASON_CAP = 160;

/** Fold a caught value into the tail of a sentence: no surrounding whitespace, no trailing
 *  period doubling the one the sentence does not have, nothing longer than a line. */
function reasonText(cause: unknown): string {
	if (cause === undefined || cause === null) return '';
	const raw = (cause instanceof Error ? cause.message : String(cause)).trim().replace(/\.$/, '');
	if (!raw) return '';
	return raw.length > REASON_CAP ? `${raw.slice(0, REASON_CAP).trimEnd()}…` : raw;
}

/**
 * The app's one failure sentence. `act` is what was being attempted, as a bare verb phrase the
 * sentence completes: 'save the preset', 'import "Alice"', 'reach the server'.
 *
 * Exported because the in-place channel needs the same words: a panel that renders its own
 * failure line (`ui/Alert.svelte`) must not re-invent the phrasing the toast stack uses, or the
 * app apologises in two voices depending on which surface happened to catch the error.
 */
export function failureText(act: string, cause?: unknown): string {
	const reason = reasonText(cause);
	return reason ? `Couldn't ${act}: ${reason}` : `Couldn't ${act}`;
}

class ToastStore {
	toasts = $state<Toast[]>([]);
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	private show(message: string, tone: ToastTone, link?: ToastLink): void {
		const text = message.trim();
		if (!text) return;

		// A loop that fails ten times has one thing to say, not ten. Only identical lines fold,
		// so two different files failing an import still name themselves separately.
		const twin = this.toasts.find((t) => t.message === text && t.tone === tone && t.link?.key === link?.key);
		if (twin) {
			twin.count += 1;
			twin.link = link;
			this.arm(twin.id, tone);
			return;
		}

		const id = crypto.randomUUID();
		this.toasts = [...this.toasts, { id, message: text, tone, count: 1, ...(link ? { link } : {}) }];
		while (this.toasts.length > MAX_VISIBLE) this.remove(this.toasts[0].id);
		this.arm(id, tone);
	}

	/** (Re)start a toast's stay. A folded repeat resets it, so a run of failures stays readable
	 *  for a full duration after the last one rather than expiring on the first one's clock. */
	private arm(id: string, tone: ToastTone): void {
		const running = this.timers.get(id);
		if (running) clearTimeout(running);
		this.timers.set(
			id,
			setTimeout(() => this.remove(id), DURATION[tone])
		);
	}

	remove(id: string): void {
		const timer = this.timers.get(id);
		if (timer) clearTimeout(timer);
		this.timers.delete(id);
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	success(message: string): void {
		this.show(message, 'success');
	}

	info(message: string, link?: ToastLink): void {
		this.show(message, 'info', link);
	}

	warning(message: string): void {
		this.show(message, 'warning');
	}

	/** A refusal or a validation in your own words. Anything thrown goes through `failed`. */
	error(message: string): void {
		this.show(message, 'error');
	}

	/** The one door a caught error takes to the toast stack; `failureText` writes the sentence. */
	failed(act: string, cause?: unknown): void {
		this.show(failureText(act, cause), 'error');
	}
}

export const toastStore = new ToastStore();
