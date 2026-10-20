/**
 * Client preset service.
 *
 * Presets are JSON files on the server. Editing never touches the committed file:
 * every change is written to a per-preset draft (data/presets/temp/<id>.json) that
 * lives until you Save (commit + drop draft) or Discard (drop draft). The "effective"
 * preset (draft if one exists, else committed) is what the editor shows AND what
 * generation uses, so you can try changes live and revert if you don't like them.
 */
import type { PromptPreset, PromptItem, PromptControl } from '$lib/types/database';
import { apiGet, apiSend, getClientId } from '$lib/services/transport';
import { db } from '$lib/services/database';
import { imageService } from '$lib/services/imageService';
import { registerSettingsReload } from '$lib/services/syncedSetting';
import { parsePresetJson, promptItemBody, serializePresetJson, type ImportedPreset } from '$lib/services/preset-io';
import type { RegexRule } from '$lib/utils/regex-rules';
import { SvelteMap } from 'svelte/reactivity';

function slugify(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.substring(0, 50);
}

/** Older files have no item ids; new writes persist them so live editors keep their rows. */
type StoredPreset = Omit<PromptPreset, 'items'> & { items: (Omit<PromptItem, 'id'> & { id?: string })[] };

/** Deep-copy controls so nested option arrays aren't shared between presets. */
function cloneControls(controls?: PromptControl[]): PromptControl[] {
	return (controls ?? []).map((control) => ({
		...control,
		options: control.options?.map((option) => ({ ...option })),
		defaultOptionIds: control.defaultOptionIds ? [...control.defaultOptionIds] : undefined,
		defaultRange: control.defaultRange ? [...control.defaultRange] : undefined
	}));
}

function cloneRules(rules?: RegexRule[]): RegexRule[] | undefined {
	return rules?.map((rule) => ({ ...rule, targets: [...rule.targets], scopes: [...rule.scopes] }));
}

/**
 * Deep copy of everything a preset owns EXCEPT its items, whose ids are the caller's
 * business (preserved on reload/save, renewed on import/duplicate, ignored for content equality).
 *
 * This is the single per-preset field list, the one architecture/prompt-pipeline.md
 * coupling 9 keeps pointing at. `hydrate`, `strip`, `clone`, `duplicatePreset` and the
 * Prompt Builder's working copy all route through it, so a new field reaches every one of
 * them at once instead of surviving Save and vanishing on the next unrelated edit. Key
 * order is fixed here on purpose: `strip` drives `sameContent`, which compares serialized
 * output, and two orders would read as two different presets.
 */
function clonePresetBody(preset: Omit<StoredPreset, 'id' | 'items'>) {
	return {
		name: preset.name,
		controls: cloneControls(preset.controls),
		sections: preset.sections?.map((section) => ({ ...section })),
		bundles: preset.bundles?.map((bundle) => ({ ...bundle, values: { ...bundle.values } })),
		meta: preset.meta ? { ...preset.meta } : undefined,
		regexRules: cloneRules(preset.regexRules),
		pruneEmptyBlocks: preset.pruneEmptyBlocks === true,
		exampleSeparator: preset.exampleSeparator,
		continuePrompt: preset.continuePrompt
	};
}

/**
 * A working copy nothing else shares. The Prompt Builder edits one of these and writes it
 * back as a draft, so every mutation there is safely local until it persists.
 */
export function clonePreset(preset: PromptPreset): PromptPreset {
	return {
		id: preset.id,
		...clonePresetBody(preset),
		items: preset.items.map((item) => ({ id: item.id, ...promptItemBody(item) }))
	};
}

export class PresetService {
	// Reactive so every consumer ($derived over getAllPresets/getActivePresetId in
	// InputArea, PromptBuilder, etc.) refreshes the instant the set or selection changes,
	// with no page reload needed. Plain Map/field reads weren't tracked by Svelte.
	private presets = new SvelteMap<string, PromptPreset>(); // committed (saved) presets
	private drafts = new SvelteMap<string, PromptPreset>(); // unsaved working copies
	private initialized = false;
	private loadTicket = 0;
	private pendingWrites = new Map<string, number>();
	private activePresetId = $state<string | null>(null);
	// Only changes to the active effective preset tick this. Prompt Builder refreshes an
	// already-open editor when the active id stays the same (remote draft/default reset).
	private contentVersion = $state(0);

	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.loadAll();
		await this.loadActivePresetId();
		await this.ensureActivePreset();
		registerSettingsReload(() => this.syncActivePresetId());
		this.initialized = true;
	}

	private async loadActivePresetId(): Promise<void> {
		const presetId = await db.getSetting('activePresetId');
		if (presetId) {
			this.activePresetId = presetId;
			return;
		}
		// One-shot carry-over from the per-mode selection. Only reachable while no
		// `activePresetId` exists at all; `ensureActivePreset` writes one on this same boot,
		// so it never runs twice. Unparseable JSON throws rather than starting the user on a
		// silently different preset than the one they left.
		const oldData = await db.getSetting('activePresetByMode');
		if (!oldData) return;
		const map = JSON.parse(oldData);
		if (map.story) {
			this.activePresetId = map.story;
			await db.setSetting('activePresetId', map.story);
		}
	}

	getActivePresetId(): string | null {
		return this.activePresetId;
	}

	getContentVersion(): number {
		return this.contentVersion;
	}

	/** The only active-preset mutation path. Every consumer reads this same state. */
	async activatePreset(presetId: string): Promise<PromptPreset> {
		const preset = this.getEffective(presetId);
		if (!preset) throw new Error(`Preset not found: ${presetId}`);
		const previous = this.activePresetId;
		this.activePresetId = presetId;
		try {
			await db.setSetting('activePresetId', presetId);
		} catch (error) {
			this.activePresetId = previous && this.getEffective(previous) ? previous : null;
			throw error;
		}
		return preset;
	}

	/** Reload file-backed presets after the server's `presets` sync hint. */
	async syncReload(): Promise<void> {
		if (await this.loadAll()) this.contentVersion++;
		await this.syncActivePresetId();
	}

	private async syncActivePresetId(): Promise<void> {
		this.activePresetId = (await db.getSetting('activePresetId')) || null;
		await this.ensureActivePreset();
	}

	private async ensureActivePreset(): Promise<void> {
		if (this.activePresetId && this.getEffective(this.activePresetId)) return;
		let next = this.getAllPresets()[0] ?? null;
		if (!next) next = await this.createPreset('New Preset');
		await this.activatePreset(next.id);
	}

	private async loadAll(): Promise<boolean> {
		const ticket = ++this.loadTicket;
		const beforePresets = new Map(this.presets), beforeDrafts = new Map(this.drafts);
		const writingAtStart = new Set(this.pendingWrites.keys());
		const data = (await apiGet('/api/presets')) as { presets: StoredPreset[]; drafts: StoredPreset[] };
		if (ticket !== this.loadTicket) return false;
		const presets = new Map<string, PromptPreset>(), drafts = new Map<string, PromptPreset>();
		for (const stored of data.presets) {
			presets.set(stored.id, this.hydrate(stored, beforePresets.get(stored.id)));
		}
		for (const stored of data.drafts ?? []) {
			// Ignore orphan drafts whose committed preset no longer exists.
			const committed = presets.get(stored.id);
			if (!committed) continue;
			const draft = this.hydrate(stored, beforeDrafts.get(stored.id) ?? beforePresets.get(stored.id) ?? committed);
			// Redundant drafts do not mean unsaved work. A read must never delete the file:
			// another device (or a local write) may have replaced it since the snapshot.
			if (this.sameContent(draft, committed)) continue;
			drafts.set(stored.id, draft);
		}
		// A read must not rewind edits, saves, imports or deletions made while it was in flight.
		const ids = new Set([...beforePresets.keys(), ...beforeDrafts.keys(), ...this.presets.keys(), ...this.drafts.keys(), ...writingAtStart, ...this.pendingWrites.keys()]);
		for (const id of ids) {
			if (!writingAtStart.has(id) && !this.pendingWrites.has(id) && this.presets.get(id) === beforePresets.get(id) && this.drafts.get(id) === beforeDrafts.get(id)) continue;
			const committed = this.presets.get(id), draft = this.drafts.get(id);
			if (committed) presets.set(id, committed); else presets.delete(id);
			if (draft) drafts.set(id, draft); else drafts.delete(id);
		}
		const before = this.activePresetId ? this.getEffective(this.activePresetId) : null;
		// Publish only after the read succeeds, with no await between the two maps.
		for (const id of this.presets.keys()) if (!presets.has(id)) this.presets.delete(id);
		for (const [id, preset] of presets) if (this.presets.get(id) !== preset) this.presets.set(id, preset);
		for (const id of this.drafts.keys()) if (!drafts.has(id)) this.drafts.delete(id);
		for (const [id, draft] of drafts) if (this.drafts.get(id) !== draft) this.drafts.set(id, draft);
		return before !== (this.activePresetId ? this.getEffective(this.activePresetId) : null);
	}

	/**
	 * Material equality ignores item ids and compares every authored field. This decides
	 * whether an edit state is actually a draft or just the committed preset again.
	 */
	private sameContent(a: PromptPreset, b: PromptPreset): boolean {
		return JSON.stringify(this.strip(a)) === JSON.stringify(this.strip(b));
	}

	private hydrate(stored: StoredPreset, previous?: PromptPreset): PromptPreset {
		const items = (stored.items ?? []).map(item => ({ id: item.id, ...promptItemBody(item) }));
		const validId = (item: { id?: string }) => typeof item.id === 'string' && item.id.trim() ? item.id : null;
		const preset: PromptPreset = {
			id: stored.id, ...clonePresetBody(stored),
			items: items.map(item => ({ ...item, id: validId(item) ?? '' }))
		};
		// The usual reconnect is unchanged: reuse it before doing any legacy row matching.
		if (previous && this.sameContent(preset, previous) && preset.items.every((item, index) => !item.id || item.id === previous.items[index]?.id)) return previous;
		const reserved = new Set(items.map(validId).filter((id): id is string => id !== null));
		const used = new Set<string>();
		const fingerprint = (item: Omit<PromptItem, 'id'>) => JSON.stringify(promptItemBody(item));
		preset.items = items.map((item) => {
			let id = validId(item);
			if (!id || used.has(id)) {
				// Legacy files: match unchanged items first (also across reorders), then a
				// uniquely named row whose text/role may have been edited. Never reuse an id twice.
				const candidates = (previous?.items ?? []).filter(old => !used.has(old.id) && !reserved.has(old.id));
				const exact = candidates.find(old => fingerprint(old) === fingerprint(item));
				const named = item.name ? candidates.filter(old => old.name === item.name) : [];
				const uniqueName = named.length === 1 && items.filter(other => other.name === item.name).length === 1 ? named[0] : undefined;
				id = exact?.id ?? uniqueName?.id ?? crypto.randomUUID();
			}
			used.add(id);
			return { ...item, id };
		});
		return previous && this.sameContent(preset, previous) && preset.items.every((item, index) => item.id === previous.items[index]?.id)
			? previous : preset;
	}

	/**
	 * Content comparison omits item ids; storage preserves them. Public JSON/PNG exports
	 * still use preset-io's document shape, which omits item ids and renews them on import.
	 */
	private strip(preset: PromptPreset): Omit<StoredPreset, 'id'> {
		return {
			...clonePresetBody(preset),
			items: preset.items.map(promptItemBody)
		};
	}

	private toStored(preset: PromptPreset): Omit<StoredPreset, 'id'> {
		return { ...this.strip(preset), items: preset.items.map(item => ({ id: item.id, ...promptItemBody(item) })) };
	}

	private clone(preset: PromptPreset): PromptPreset {
		return clonePreset(preset);
	}

	/** Committed presets (the names shown in the picker). */
	getAllPresets(): PromptPreset[] {
		return Array.from(this.presets.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/** The preset to edit and to generate from: the draft if one exists, else committed. */
	getEffective(id: string): PromptPreset | null {
		return this.drafts.get(id) ?? this.presets.get(id) ?? null;
	}

	/** The saved preset, ignoring any draft over it. Needed where an edit puts a FILE on
	 *  disk (the cover) and the loser has to be identified before the draft is resolved. */
	getCommitted(id: string): PromptPreset | null {
		return this.presets.get(id) ?? null;
	}

	/** Effective preset for the active id. The first-preset fallback only covers boot. */
	getActiveEffectivePreset(): PromptPreset | null {
		if (this.activePresetId) {
			const active = this.getEffective(this.activePresetId);
			if (active) return active;
		}
		const first = this.getAllPresets()[0];
		return first ? this.getEffective(first.id) : null;
	}

	hasDraft(id: string): boolean {
		return this.drafts.has(id);
	}

	/** Case-insensitive, trimmed name collision check against committed presets. */
	isNameTaken(name: string, exceptId?: string): boolean {
		const target = name.trim().toLowerCase();
		for (const preset of this.presets.values()) {
			if (preset.id !== exceptId && preset.name.trim().toLowerCase() === target) return true;
		}
		return false;
	}

	// ===== Editing (drafts) =====

	private async withPendingWrite<T>(id: string, write: () => Promise<T>): Promise<T> {
		this.pendingWrites.set(id, (this.pendingWrites.get(id) ?? 0) + 1);
		try { return await write(); }
		finally {
			const count = this.pendingWrites.get(id)! - 1;
			if (count) this.pendingWrites.set(id, count); else this.pendingWrites.delete(id);
		}
	}

	/**
	 * Persist the in-progress edit to the preset's draft. Does not touch the committed
	 * file. If the edit state matches the committed preset (an edit typed and reverted,
	 * a drop back onto the same spot, …), any existing draft is dropped instead:
	 * "unsaved changes" exists exactly when the content actually differs.
	 */
	async saveDraft(preset: PromptPreset): Promise<void> {
		return this.withPendingWrite(preset.id, async () => {
			const committed = this.presets.get(preset.id);
			if (committed && this.sameContent(preset, committed)) {
				await this.discardDraft(preset.id);
				return;
			}
			this.drafts.set(preset.id, this.clone(preset));
			await apiSend(`/api/presets/${encodeURIComponent(preset.id)}/draft`, 'PUT', {
				...this.toStored(preset),
				clientId: getClientId()
			});
		});
	}

	/** Save: write the draft onto the committed preset and drop the draft. */
	async commitDraft(id: string): Promise<PromptPreset | null> {
		return this.withPendingWrite(id, async () => {
			const draft = this.drafts.get(id);
			if (!draft) return this.presets.get(id) ?? null;
			await apiSend(`/api/presets/${encodeURIComponent(id)}`, 'PUT', { ...this.toStored(draft), clientId: getClientId() });
			await apiSend(`/api/presets/${encodeURIComponent(id)}/draft`, 'DELETE', { clientId: getClientId() });
			const committed = this.clone(draft);
			this.presets.set(id, committed);
			this.drafts.delete(id);
			return committed;
		});
	}

	/** Discard: drop the draft, reverting to the committed preset. */
	async discardDraft(id: string): Promise<PromptPreset | null> {
		return this.withPendingWrite(id, async () => {
			if (this.drafts.has(id)) {
				this.drafts.delete(id);
				await apiSend(`/api/presets/${encodeURIComponent(id)}/draft`, 'DELETE', { clientId: getClientId() });
			}
			return this.presets.get(id) ?? null;
		});
	}

	// ===== Preset lifecycle =====

	async createPreset(name: string): Promise<PromptPreset> {
		const id = this.generateUniqueId(name);
		const newPreset: PromptPreset = { id, name: name.trim(), items: [], controls: [] };
		await apiSend(`/api/presets/${encodeURIComponent(id)}`, 'PUT', { ...this.toStored(newPreset), clientId: getClientId() });
		this.presets.set(id, newPreset);
		return newPreset;
	}

	async duplicatePreset(sourceId: string, newName: string): Promise<PromptPreset> {
		// Duplicate what the user is actually using. If Prompt Builder has a draft,
		// the copy includes it without saving or discarding the source draft.
		const source = this.getEffective(sourceId);
		if (!source) throw new Error(`Preset not found: ${sourceId}`);
		const id = this.generateUniqueId(newName);
		const newPreset: PromptPreset = {
			...clonePreset(source),
			id,
			name: newName.trim(),
			items: source.items.map((item) => ({ ...promptItemBody(item), id: crypto.randomUUID() }))
		};
		await apiSend(`/api/presets/${encodeURIComponent(id)}`, 'PUT', { ...this.toStored(newPreset), clientId: getClientId() });
		this.presets.set(id, newPreset);
		return newPreset;
	}

	async deletePreset(id: string): Promise<void> {
		// The cover belongs to this preset alone (import and upload both mint a fresh file),
		// so it goes with it rather than lingering as an orphan nothing can reach. Both sides
		// are collected: a draft that swapped the cover leaves TWO files behind, and only one
		// of them is the one the effective preset names.
		const covers = this.coversOf(id);
		await apiSend(`/api/presets/${encodeURIComponent(id)}`, 'DELETE', { clientId: getClientId() });
		for (const path of covers) await imageService.deleteImage(path);
		this.presets.delete(id);
		this.drafts.delete(id);
		if (this.activePresetId === id) await this.ensureActivePreset();
	}

	async importPresetJson(text: string): Promise<PromptPreset> {
		return this.importPreset(parsePresetJson(text));
	}

	/** Land a parsed preset under a free name. `cover` is a stored image path the caller
	 *  already saved: the PNG card path supplies one, a JSON import never does. */
	async importPreset(imported: ImportedPreset, cover?: string): Promise<PromptPreset> {
		let name = imported.name;
		for (let n = 2; this.isNameTaken(name); n++) name = `${imported.name} (${n})`;
		const complete: PromptPreset = {
			id: this.generateUniqueId(name),
			...imported,
			name,
			...(cover ? { meta: { ...imported.meta, cover } } : {})
		};
		await apiSend(`/api/presets/${encodeURIComponent(complete.id)}`, 'PUT', {
			...this.toStored(complete),
			clientId: getClientId()
		});
		this.presets.set(complete.id, complete);
		return complete;
	}

	exportPresetJson(id: string): string {
		const preset = this.getEffective(id);
		if (!preset) throw new Error(`Preset not found: ${id}`);
		return serializePresetJson(preset);
	}

	/** Every cover file one preset is holding: committed and draft can name different ones. */
	private coversOf(id: string): string[] {
		const paths = [this.presets.get(id)?.meta?.cover, this.drafts.get(id)?.meta?.cover];
		return [...new Set(paths.filter((path): path is string => !!path))];
	}

	/** Factory reset: wipe all presets + drafts on the server, then reload defaults. */
	async restoreDefaults(): Promise<void> {
		// Covers are files, not rows: the server's wipe cannot see them, so collect them
		// before the presets that name them are gone.
		const covers = this.getAllPresets().flatMap((preset) => this.coversOf(preset.id));
		await apiSend('/api/presets/restore-defaults', 'POST', { clientId: getClientId() });
		for (const path of covers) await imageService.deleteImage(path);
		await this.loadAll();
		this.activePresetId = null;
		await this.ensureActivePreset();
		this.contentVersion++;
	}

	private generateUniqueId(name: string): string {
		const baseSlug = slugify(name) || 'preset';
		let slug = baseSlug;
		let counter = 1;
		while (this.presets.has(slug)) {
			slug = `${baseSlug}-${counter}`;
			counter++;
		}
		return slug;
	}
}

export const presetService = new PresetService();
