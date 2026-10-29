/**
 * How the lorebook shelf is drawn and ordered: layout, grid columns, results per page, whether a
 * shelf row draws its cover, and the display order.
 *
 * The ORDER is one choice for the whole app, not one per list: the Library's Lorebooks shelf
 * and the link picker in the character editor are two views of the same shelf, and picking an
 * order twice would cost exactly the work this exists to save. The other four belong to the
 * shelf alone, since the picker is a popover with one shape.
 *
 * Rides the settings spine like the browse-view prefs, so it survives a reload and
 * follows the user to their other devices. **The key is still `lorebookSort`**, which is what
 * every install already holds: a bare string there is a stored order from before the shelf had
 * anything else to remember, and it is read back as one rather than dropped.
 *
 * Display only: `lorebookStore.books` is never reordered, because link resolution reads that
 * order to decide what reaches the prompt first (`sortLorebooks` in lorebook/types.ts).
 */
import { readSetting, writeSetting, registerSettingsReload, reloadSettings } from '#lib/services/syncedSetting.ts';
import { DEFAULT_GRID_COLUMNS, normalizeGridColumns, PER_PAGE_OPTIONS, type ViewMode } from '#lib/components/library/browse.ts';
import type { LorebookSortOrder } from '#lib/lorebook/types.ts';

const SETTINGS_KEY = 'lorebookSort';

/** The orders offered, in the order they are offered. Also the validity list a stored value is
 *  read back through, so an option that goes away cannot leave a device on it. */
export const LOREBOOK_SORT_OPTIONS: { id: LorebookSortOrder; label: string }[] = [
	{ id: 'a-z', label: 'A → Z' },
	{ id: 'z-a', label: 'Z → A' },
	{ id: 'newest', label: 'Newest' },
	{ id: 'oldest', label: 'Oldest' },
	{ id: 'updated', label: 'Recently edited' },
	{ id: 'most-entries', label: 'Most entries' },
	{ id: 'fewest-entries', label: 'Fewest entries' }
];

const VIEW_MODES: ViewMode[] = ['grid', 'list', 'gallery'];

interface LorebookViewState {
	order: LorebookSortOrder;
	viewMode: ViewMode;
	gridColumns: number;
	perPage: number;
	/** Shelf rows draw the book's cover. On by default: hiding art nobody asked to hide reads
	 *  as a picture that failed to load, and the reader who wants the density can say so. */
	listCovers: boolean;
}

/** List, because a shelf is scanned by name far more often than it is browsed by cover, and
 *  most books carry no cover at all. */
const DEFAULTS: LorebookViewState = {
	order: 'a-z',
	viewMode: 'list',
	gridColumns: DEFAULT_GRID_COLUMNS,
	perPage: 50,
	listCovers: true
};

export function normalizeLorebookViewState(raw: unknown): LorebookViewState {
	// A bare string is the stored order from before this held anything else.
	const blob = (typeof raw === 'string' ? { order: raw } : (raw ?? {})) as Partial<LorebookViewState>;
	return {
		order: LOREBOOK_SORT_OPTIONS.find((option) => option.id === blob.order)?.id ?? DEFAULTS.order,
		viewMode: VIEW_MODES.includes(blob.viewMode as ViewMode)
			? (blob.viewMode as ViewMode)
			: DEFAULTS.viewMode,
		gridColumns: normalizeGridColumns(blob.gridColumns),
		perPage: PER_PAGE_OPTIONS.includes(blob.perPage as number) ? (blob.perPage as number) : DEFAULTS.perPage,
		listCovers: typeof blob.listCovers === 'boolean' ? blob.listCovers : DEFAULTS.listCovers
	};
}

class LorebookViewPrefs {
	order = $state<LorebookSortOrder>(DEFAULTS.order);
	viewMode = $state<ViewMode>(DEFAULTS.viewMode);
	gridColumns = $state<number>(DEFAULTS.gridColumns);
	perPage = $state<number>(DEFAULTS.perPage);
	listCovers = $state<boolean>(DEFAULTS.listCovers);

	async initialize(): Promise<void> {
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		await reloadSettings([SETTINGS_KEY], () => readSetting<unknown>(SETTINGS_KEY, null), raw => {
			const state = normalizeLorebookViewState(raw);
			this.order = state.order;
			this.viewMode = state.viewMode;
			this.gridColumns = state.gridColumns;
			this.perPage = state.perPage;
			this.listCovers = state.listCovers;
		});
	}

	setOrder(order: LorebookSortOrder): void {
		this.order = order;
		this.persist();
	}

	setViewMode(viewMode: ViewMode): void {
		this.viewMode = viewMode;
		this.persist();
	}

	setGridColumns(columns: number): void {
		this.gridColumns = normalizeGridColumns(columns);
		this.persist();
	}

	setPerPage(perPage: number): void {
		this.perPage = perPage;
		this.persist();
	}

	setListCovers(listCovers: boolean): void {
		this.listCovers = listCovers;
		this.persist();
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, {
			order: this.order,
			viewMode: this.viewMode,
			gridColumns: this.gridColumns,
			perPage: this.perPage,
			listCovers: this.listCovers
		} satisfies LorebookViewState);
	}
}

export const lorebookViewPrefs = new LorebookViewPrefs();

/** The default view choices, including the column slider's reset value. */
export const LOREBOOK_VIEW_DEFAULTS = DEFAULTS;
