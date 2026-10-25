/**
 * Browse-view preferences for the Library's Characters and Personas lists.
 *
 * View mode, grid columns, sort order, and results-per-page: the toolbar choices the
 * user makes while browsing. Formerly stored per-device in localStorage; now they
 * ride the settings spine so a choice on one device follows the user to the others.
 * One packed settings key per surface.
 */
import { DEFAULT_GRID_COLUMNS, normalizeGridColumns, PER_PAGE_OPTIONS, CHARACTER_SORT_OPTIONS, type SortOption, type ViewMode } from '$lib/components/library/browse';
import { readSetting, writeSetting, registerSettingsReload, reloadSettings } from '$lib/services/syncedSetting';

interface BrowseViewState {
	viewMode: ViewMode;
	gridColumns: number;
	sort: SortOption;
	perPage: number;
	/** List rows draw the entry's tags. Off by default: the strip costs the preview line
	 *  its second row, which is a trade only the reader can make. */
	listTags: boolean;
	/** Grid cards optionally show a compact tag strip over the portrait. */
	gridTags: boolean;
	/** List rows draw the entry's portrait. On by default: the portrait is how a shelf of
	 *  same-named characters is told apart, and an install that hid them by surprise would
	 *  read as art that failed to load. */
	listPortraits: boolean;
}

export const DEFAULTS: BrowseViewState = {
	viewMode: 'list',
	gridColumns: DEFAULT_GRID_COLUMNS,
	sort: 'newest',
	perPage: 50,
	listTags: false,
	gridTags: false,
	listPortraits: true
};

const VIEW_MODES: ViewMode[] = ['grid', 'list', 'gallery'];

/** Coerce a raw settings blob into a valid state, dropping anything out of range. */
function normalize(raw: Partial<BrowseViewState> | null): BrowseViewState {
	const viewMode = VIEW_MODES.includes(raw?.viewMode as ViewMode) ? (raw!.viewMode as ViewMode) : DEFAULTS.viewMode;
	const gridColumns = normalizeGridColumns(raw?.gridColumns);
	// Validate against the characters superset: personas simply never offer the extras.
	const sort = CHARACTER_SORT_OPTIONS.some((o) => o.id === raw?.sort) ? (raw!.sort as SortOption) : DEFAULTS.sort;
	const perPage = PER_PAGE_OPTIONS.includes(raw?.perPage as number) ? (raw!.perPage as number) : DEFAULTS.perPage;
	const listTags = typeof raw?.listTags === 'boolean' ? raw.listTags : DEFAULTS.listTags;
	const gridTags = typeof raw?.gridTags === 'boolean' ? raw.gridTags : DEFAULTS.gridTags;
	const listPortraits =
		typeof raw?.listPortraits === 'boolean' ? raw.listPortraits : DEFAULTS.listPortraits;
	return { viewMode, gridColumns, sort, perPage, listTags, gridTags, listPortraits };
}

class BrowseViewPrefs {
	#key: string;

	viewMode = $state<ViewMode>(DEFAULTS.viewMode);
	gridColumns = $state<number>(DEFAULTS.gridColumns);
	sort = $state<SortOption>(DEFAULTS.sort);
	perPage = $state<number>(DEFAULTS.perPage);
	listTags = $state<boolean>(DEFAULTS.listTags);
	gridTags = $state<boolean>(DEFAULTS.gridTags);
	listPortraits = $state<boolean>(DEFAULTS.listPortraits);

	constructor(key: string) {
		this.#key = key;
	}

	async initialize(): Promise<void> {
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		await reloadSettings([this.#key], () => readSetting<Partial<BrowseViewState> | null>(this.#key, null), raw => this.apply(normalize(raw)));
	}

	private apply(state: BrowseViewState): void {
		this.viewMode = state.viewMode;
		this.gridColumns = state.gridColumns;
		this.sort = state.sort;
		this.perPage = state.perPage;
		this.listTags = state.listTags;
		this.gridTags = state.gridTags;
		this.listPortraits = state.listPortraits;
	}

	setViewMode(mode: ViewMode): void {
		this.viewMode = mode;
		this.persist();
	}

	setGridColumns(columns: number): void {
		this.gridColumns = normalizeGridColumns(columns);
		this.persist();
	}

	setSort(sort: SortOption): void {
		this.sort = sort;
		this.persist();
	}

	setPerPage(perPage: number): void {
		this.perPage = perPage;
		this.persist();
	}

	setListTags(listTags: boolean): void {
		this.listTags = listTags;
		this.persist();
	}

	setListPortraits(listPortraits: boolean): void {
		this.listPortraits = listPortraits;
		this.persist();
	}

	setGridTags(gridTags: boolean): void {
		this.gridTags = gridTags;
		this.persist();
	}

	private persist(): void {
		writeSetting(this.#key, {
			viewMode: this.viewMode,
			gridColumns: this.gridColumns,
			sort: this.sort,
			perPage: this.perPage,
			listTags: this.listTags,
			gridTags: this.gridTags,
			listPortraits: this.listPortraits
		} satisfies BrowseViewState);
	}
}

export const libraryViewPrefs = new BrowseViewPrefs('libraryViewPrefs');
export const personasViewPrefs = new BrowseViewPrefs('personasViewPrefs');
