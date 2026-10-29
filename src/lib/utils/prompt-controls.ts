/**
 * Helpers shared by the Preset Controls UI (renders custom controls) and the macro
 * system (injects their values into the prompt). One place so both agree on what a
 * control's effective value is and how it turns into prompt text.
 */

import type { PromptControl } from '#lib/types/database.ts';

/** A range's two ends, low first. */
export type RangeValue = [number, number];

export type ControlValue = string | number | boolean | string[] | RangeValue;

/** The track a slider or range moves along. */
function trackBounds(control: PromptControl): RangeValue {
	return [control.min ?? 0, control.max ?? 100];
}

/** Clamp a pair into the track and put the low end first, so no reader or template ever
 *  sees an inverted or out-of-track span. */
function orderedRange(low: number, high: number, control: PromptControl): RangeValue {
	const [min, max] = trackBounds(control);
	const a = Math.min(Math.max(low, min), max);
	const b = Math.min(Math.max(high, min), max);
	return a <= b ? [a, b] : [b, a];
}

/** The default value for a control when the chat hasn't set one yet. */
export function getControlDefaultValue(control: PromptControl): ControlValue {
	switch (control.type) {
		case 'text':
		case 'textarea':
			return control.defaultText ?? '';
		case 'toggle':
			return control.defaultOn ?? false;
		case 'slider':
			return control.defaultNumber ?? control.min ?? 0;
		case 'range': {
			const [min, max] = trackBounds(control);
			const [low, high] = control.defaultRange ?? [min, max];
			return orderedRange(low, high, control);
		}
		case 'select':
		case 'radio':
			return control.defaultOptionId ?? control.options?.[0]?.id ?? '';
		case 'tags':
			return control.defaultOptionIds ?? [];
	}
}

/** The effective value: the chat's stored value, or the control default. */
export function getControlValue(control: PromptControl, raw: unknown): ControlValue {
	if (raw === undefined || raw === null) return getControlDefaultValue(control);

	switch (control.type) {
		case 'text':
		case 'textarea':
			return typeof raw === 'string' ? raw : String(raw);
		case 'toggle':
			return typeof raw === 'boolean' ? raw : Boolean(raw);
		case 'slider':
			return typeof raw === 'number' ? raw : Number(raw) || getControlDefaultValue(control);
		case 'range': {
			if (!Array.isArray(raw) || raw.length !== 2) return getControlDefaultValue(control);
			const [low, high] = [Number(raw[0]), Number(raw[1])];
			if (!Number.isFinite(low) || !Number.isFinite(high)) return getControlDefaultValue(control);
			return orderedRange(low, high, control);
		}
		case 'select':
		case 'radio':
			return typeof raw === 'string' ? raw : '';
		case 'tags':
			return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
	}
}

/** Turn a control's effective value into the text injected into the prompt. */
export function formatControlForPrompt(control: PromptControl, raw: unknown): string {
	const value = getControlValue(control, raw);

	switch (control.type) {
		case 'text':
		case 'textarea': {
			const text = String(value);
			if (!control.textTemplate) return text;
			// The template frames the reader's text ("Extra rules: {{value}}"). With nothing
			// to frame, inject nothing so the framing label can't dangle in the prompt.
			if (!text.trim()) return '';
			return control.textTemplate.replace(/\{\{value\}\}/g, text);
		}

		case 'toggle':
			return (value ? control.onText : control.offText) ?? '';

		case 'slider': {
			const n = value as number;
			if (control.sliderTemplate) {
				return control.sliderTemplate.replace(/\{\{value\}\}/g, String(n));
			}
			return String(n);
		}

		case 'range': {
			const [low, high] = value as RangeValue;
			if (control.rangeTemplate) {
				return control.rangeTemplate
					.replace(/\{\{min\}\}/g, String(low))
					.replace(/\{\{max\}\}/g, String(high));
			}
			return `${low}–${high}`;
		}

		case 'select':
		case 'radio': {
			const option = control.options?.find((o) => o.id === value);
			return option?.injectedText ?? '';
		}

		case 'tags': {
			const entries = value as string[];
			const separator = control.tagSeparator ?? ', ';
			return entries
				.map((entry) => {
					const option = control.options?.find((o) => o.id === entry);
					if (option) return option.injectedText;
					// Not one of the author's options. With free entry on, the reader typed it and
					// it injects as written; with it off, it is a stale id and injects nothing.
					return control.allowCustom ? entry : '';
				})
				.filter((text) => text.length > 0)
				.join(separator);
		}
	}
}
