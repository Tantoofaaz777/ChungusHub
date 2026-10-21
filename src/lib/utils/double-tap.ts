type TapPoint = { id: number; x: number; y: number; time: number };

export const TAP_HOLD_MS = 250;
export const DOUBLE_TAP_GAP_MS = 350;
const MOVE_SLOP = 8;
const PAIR_SLOP = 24;
const distance = (a: TapPoint, b: TapPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Only two short, stationary presses qualify. Scroll/cancel is owned by the DOM action. */
export class DoubleTapGesture {
	private press: TapPoint | null = null;
	private previous: TapPoint | null = null;
	get active() { return this.press !== null || this.previous !== null; }

	start(point: TapPoint): void {
		if (this.press) { this.cancel(); return; }
		this.press = point;
	}

	move(point: TapPoint): void {
		if (this.press?.id === point.id && distance(this.press, point) > MOVE_SLOP) this.cancel();
	}

	end(point: TapPoint): boolean {
		const press = this.press;
		if (!press || press.id !== point.id) return false;
		this.press = null;
		if (point.time - press.time > TAP_HOLD_MS || distance(press, point) > MOVE_SLOP) {
			this.cancel(); return false;
		}
		const previous = this.previous;
		if (previous && press.time - previous.time <= DOUBLE_TAP_GAP_MS && distance(previous, press) <= PAIR_SLOP) {
			this.cancel(); return true;
		}
		this.previous = point;
		return false;
	}

	cancel(): void { this.press = null; this.previous = null; }
}
