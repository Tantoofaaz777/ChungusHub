/**
 * The workspace background in force.
 *
 * Which image (a /files/-relative path, bundled default or user upload) backs the
 * workspace, plus its readability knobs (dim + blur). Two places hold one, the app-wide
 * setting and the open chat's own scene (stores/chatScene.svelte.ts), and `config` is
 * whichever is in force: the picker and the sliders on Settings → Interface edit exactly
 * what is on screen. Renders at the bottom of Workspace.svelte.
 */
import {
	BurstSettingWriter,
	readSetting,
	registerSettingsReload
} from '$lib/services/syncedSetting';
import { fileUrl } from '$lib/services/transport';
import type { BackgroundConfig } from '$lib/types/background';
import { DEFAULT_BACKGROUND, normalizeBackgroundConfig } from '$lib/types/background';
import { chatSceneStore } from '$lib/stores/chatScene.svelte';

const SETTINGS_KEY = 'backgroundConfig';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

class BackgroundStore {
	/** The app-wide background: what every chat without a scene of its own wears. */
	private appConfig = $state<BackgroundConfig>({ ...DEFAULT_BACKGROUND });

	/** Dim and blur are dragged, so the writes come in bursts. */
	private writer = new BurstSettingWriter<BackgroundConfig>(SETTINGS_KEY);

	config = $derived(chatSceneStore.active?.background ?? this.appConfig);

	/** Resolved image URL, or null when no background is set. */
	url = $derived(this.config.path ? fileUrl(this.config.path) : null);

	async initialize(): Promise<void> {
		this.appConfig = normalizeBackgroundConfig(await readSetting<unknown>(SETTINGS_KEY, null));
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		const next = normalizeBackgroundConfig(await readSetting<unknown>(SETTINGS_KEY, null));
		// A write still owed is newer than anything the server can hand back.
		if (this.writer.busy) return;
		this.appConfig = next;
	}

	/** Land a whole background on whichever scene is in force. */
	private write(next: BackgroundConfig): void {
		const chatScene = chatSceneStore.active;
		if (chatScene) {
			chatSceneStore.write({ ...chatScene, background: next });
			return;
		}
		this.appConfig = next;
		this.writer.write(next);
	}

	setBackground(path: string | null): void {
		this.write({ ...this.config, path });
	}

	setDim(dim: number): void {
		this.write({ ...this.config, dim: clampNumber(dim, 0, 0.9, this.config.dim) });
	}

	setBlur(blur: number): void {
		this.write({ ...this.config, blur: clampNumber(blur, 0, 24, this.config.blur) });
	}
}

export const backgroundStore = new BackgroundStore();
