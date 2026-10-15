/** Character Card V3 interchange data retained alongside the editable character fields. */
export interface CardAsset {
	type: string;
	uri: string;
	name: string;
	ext: string;
	[key: string]: unknown;
}

export interface CharacterCardMetadata {
	version: 2 | 3;
	extensions: Record<string, unknown>;
	assets?: CardAsset[];
	creatorNotesMultilingual?: Record<string, string>;
	source?: string[];
	groupOnlyGreetings?: string[];
	creationDate?: number;
	modificationDate?: number;
	/** Installation-local background selected from the portable assets on import. */
	backgroundPath?: string;
	/** Installation-local paths of supported image assets, keyed by their array index. */
	assetPaths?: Record<string, string>;
	portraitPath?: string;
	/** Asset name selected when an imported user icon becomes a persona. */
	userIconName?: string;
	/** Original embedded book, also retained when the user elects not to add it to the shelf. */
	characterBook?: Record<string, unknown>;
	/** Future fields survive re-export; the current editable fields remain canonical. */
	extra?: Record<string, unknown>;
}

export interface CharacterCardV3 {
	spec: 'chara_card_v3';
	spec_version: '3.0';
	data: {
		name: string;
		description: string;
		personality: string;
		scenario: string;
		first_mes: string;
		mes_example: string;
		creator: string;
		creator_notes: string;
		system_prompt: string;
		post_history_instructions: string;
		character_version: string;
		tags: string[];
		alternate_greetings: string[];
		group_only_greetings: string[];
		extensions: Record<string, unknown>;
		assets?: CardAsset[];
		nickname?: string;
		creator_notes_multilingual?: Record<string, string>;
		source?: string[];
		creation_date?: number;
		modification_date?: number;
		character_book?: Record<string, unknown>;
		[key: string]: unknown;
	};
}
