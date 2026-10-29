/**
 * Per-model token calibration (reactive store + persistence).
 *
 * A local BPE encoding only estimates the real prompt size: the true count depends on each
 * model's own tokenizer plus the provider's chat-template/special-token framing, neither of
 * which we can reproduce locally for most models. But every completion reports the provider's
 * authoritative `prompt_tokens`. So after each generation we compare that actual against our
 * base estimate of the exact prompt we sent and learn a per-model correction factor (EMA).
 * Future estimates are multiplied by it, converging to the real count with zero hardcoding.
 * It works for any model, including ones that don't exist yet.
 *
 * The math lives in {@link ./calibration-core} (pure + unit-tested); this file is only the
 * reactive `$state` + db persistence around it.
 */

import { db } from '#lib/services/database.ts';
import { registerSettingsReload } from '#lib/services/syncedSetting.ts';
import { blendRatio, sampleRatio } from './calibration-core';

interface ModelFactor {
	ratio: number;
	samples: number;
}

const SETTING_KEY = 'tokenCalibration';

class TokenCalibration {
	private factors = $state<Record<string, ModelFactor>>({});
	private loaded = false;

	/** Load persisted factors at boot, then follow what the other devices learn. */
	async init(): Promise<void> {
		if (this.loaded) return;
		this.loaded = true;
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		const raw = await db.getSetting(SETTING_KEY);
		if (raw) {
			try {
				this.factors = JSON.parse(raw);
			} catch {
				/* corrupt value, start clean */
			}
		}
	}

	/** Learned actual/estimate factor for a model (1 until we have a sample). */
	ratioFor(model?: string): number {
		return (model && this.factors[model]?.ratio) || 1;
	}

	/**
	 * Feed one real generation: `estimate` is our base-encoded count of the exact prompt sent,
	 * `actual` is the provider's reported prompt_tokens. Updates the model's EMA factor.
	 */
	record(model: string, estimate: number, actual: number): void {
		if (!model) return;
		const sample = sampleRatio(estimate, actual);
		if (sample === null) return;
		const prev = this.factors[model];
		const ratio = blendRatio(prev?.ratio, sample);
		this.factors = { ...this.factors, [model]: { ratio, samples: (prev?.samples ?? 0) + 1 } };
		void db.setSetting(SETTING_KEY, JSON.stringify(this.factors));
	}
}

export const tokenCalibration = new TokenCalibration();
