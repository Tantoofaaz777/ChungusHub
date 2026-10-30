/**
 * Server-side database layer (bun:sqlite).
 *
 * This holds the real SQL. The client calls these methods by name over an HTTP RPC
 * bridge, and the method shapes are kept identical so the client-side DatabaseService
 * stays a thin proxy.
 *
 * Data is central and valuable, so the schema is versioned: each migration runs
 * exactly once, tracked in the _migrations table. No "IF NOT EXISTS" guesswork.
 */
import { Database } from 'bun:sqlite';
import { parseReasoningRetention } from '../shared/reasoning-retention';
import { normalizeAo3Information, emptyAo3Information } from '../shared/threads/ao3';
import { threadsSelectionOverlaps } from '../shared/threads/model';
import { inheritThreadsRounds } from '../shared/threads/inheritance';
import { parseGeneratedThreadsFeed } from '../shared/threads/feed';
import type { ThreadsData, ThreadsRound, ThreadsFeed, SaveThreadsRound, ThreadsNotesPatch } from '../shared/threads/types';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGES_ROOT, resolveDbPath } from './config';
import { deleteImage, IMAGE_EXT_RE, IMAGE_EXTENSIONS, thumbnailFor } from './files';
import { referencedImagePaths, referencedPresetImages } from './image-references';
import type { SyncScope } from '../shared/sync';
import { normalizeCharacterAuthorsNote, type CharacterAuthorsNote } from '../shared/character-authors-note';
import { librarySteeringNotes, type SteeringNote } from '../src/lib/types/steering';
import { captureScene, resolveScenes, scenePath, sceneLevel, MEMORY_LEVELS, type MemoryScene, type SaveMemoryScene, type SceneMessage } from '../shared/memory-scenes';

/** Short stable digest, the chat-tree fingerprint's building block. Truncated SHA-1:
 *  64 bits is far past what "are these two chats the same" needs, and it only ever
 *  compares chats that already collided on a count+length signature. */
function shortDigest(value: string): string {
	return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function imageReferenceKey(path: string): string {
	return process.platform === 'win32' ? path.toLowerCase() : path;
}

/**
 * The one case fold the chat search runs, applied IDENTICALLY in SQL (to narrow) and
 * in JS (to decide). Two rules, both deliberate:
 *
 *  - The dotted/dotless i family. Unicode pairs only I↔i, so without folding all four
 *    forms onto 'i' a search for "kapı" silently misses "KAPI", the same reason the
 *    client's `buildSearchRegex` carries `[iıIİ]` (src/lib/utils/chat-search.ts).
 *  - Case folding stops at ASCII + the five letters below, because
 *    SQLite's LOWER() is ASCII-only. Folding further in JS would make the decider
 *    accept rows the SQL narrowing already threw away, i.e. results that depend on
 *    which term happened to be longest. Consistent beats clever here.
 *
 * Every replacement is one character for one character, so an index found in the
 * folded text points at the same offset in the original, which is what lets the
 * snippet window be cut from the untouched content.
 */
const SEARCH_FOLD: [string, string][] = [
	['İ', 'i'],
	['I', 'i'],
	['ı', 'i'],
	['Ç', 'ç'],
	['Ğ', 'ğ'],
	['Ö', 'ö'],
	['Ş', 'ş'],
	['Ü', 'ü']
];

function foldSearchText(value: string): string {
	let out = value;
	for (const [from, to] of SEARCH_FOLD) out = out.split(from).join(to);
	return out.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** The SQL twin of foldSearchText, wrapped around a column expression. */
function foldSearchSql(expr: string): string {
	return SEARCH_FOLD.reduce((acc, [from, to]) => `REPLACE(${acc}, '${from}', '${to}')`, `LOWER(${expr})`);
}

/** Neutralize LIKE wildcards in a user-typed needle (paired with ESCAPE '\'). */
function escapeLike(value: string): string {
	return value.replace(/([\\%_])/g, '\\$1');
}

/** A readable window of `content` around `at`, ellipsized on whichever side is cut. */
function snippetAround(content: string, at: number, radius = 90): string {
	if (at < 0) return content.slice(0, radius * 2).trim();
	const start = Math.max(0, at - radius);
	const end = Math.min(content.length, at + radius);
	return `${start > 0 ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`;
}

/**
 * Read a JSON column that the server only carries, never interprets. A cell that will not
 * parse reads as absent instead of throwing: these columns hold records ABOUT a row rather
 * than the row itself, and one corrupt cell must never cost the reader everything the query
 * was for (`getMessagesByChat` maps a whole transcript in one pass).
 */
function parseJsonColumn(value: unknown): unknown {
	if (typeof value !== 'string' || !value) return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 * The greetings a chat opens on, in seed order: First Message, then every alternate.
 *
 * Exported so server refresh logic and the client's new-chat seeding can share the same
 * documented ordering (architecture/chat-sessions.md coupling 12).
 */
export function chatGreetingsOf(data: unknown): string[] {
	const held = (data ?? {}) as { traits?: { firstMessage?: unknown }; alternateGreetings?: unknown };
	const alternates = Array.isArray(held.alternateGreetings) ? held.alternateGreetings : [];
	return [held.traits?.firstMessage, ...alternates]
		.map((greeting) => (typeof greeting === 'string' ? greeting.trim() : ''))
		.filter((greeting) => greeting.length > 0);
}

interface Migration {
	version: number;
	name: string;
	sql: string;
}

/**
 * What a new chat with a character starts on, stored BESIDE `data` in the entry payload
 * (src/lib/types/library.ts). Listed once here because `libraryPayload` writes each only when
 * set: an entry carrying none stores exactly what it stored before they existed, which is what
 * lets a new seed land without a migration.
 */
const CHAT_DEFAULT_KEYS = [
	'defaultPersonaId',
	'defaultConnectionId',
	'defaultPresetId',
	'defaultVersionId'
] as const;

/** A chat row as a caller hands it in, shared by the two doors that create one. */
interface NewChatRow {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	rootMessageId: string | null;
	activeLeafId: string | null;
	canonLeafId?: string | null;
	settings: unknown;
	characterId?: string | null;
	characterVersionId?: string | null;
	/** The chat's opaque feature-state blob, when it is born with one (a persona stamped
	 *  from a real choice). Absent for every other door, which is a chat that follows the
	 *  app. Never parsed here (mapChat). */
	featureState?: string | null;
	isFavorite?: boolean;
}

/**
 * The whole schema as one baseline. Every change from here is a migration appended after
 * it, and a database already carrying the baseline runs only what is newer than itself.
 *
 * Its version is the number the schema stands at rather than 1, which is what makes an
 * older database fail safely: numbered 1 the baseline would read as already applied and the
 * app would run against a schema missing half its columns. Numbered where it stands it
 * reads as missing instead, its CREATEs collide with the tables already there, and the boot
 * fails where the failure can be seen.
 */
const MIGRATIONS: Migration[] = [
	{
		version: 42,
		name: 'initial_schema',
		sql: `
		CREATE TABLE chats (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT 'New Chat',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			root_message_id TEXT,
			active_leaf_id TEXT,
			settings_json TEXT,
			character_id TEXT,
			-- Legacy canon marker; retained for saved-chat compatibility and pointer repair.
			canon_leaf_id TEXT,
			character_version_id TEXT,
			-- Steering and the impersonate perspective, as an opaque JSON blob the server never
			-- parses. A corrupt value degrades client-side rather than failing the chat read,
			-- the same contract the settings table holds.
			feature_state TEXT,
			is_favorite INTEGER NOT NULL DEFAULT 0,
			-- The greeting texts the card put here when the chat was created. A chat still
			-- holding exactly these and nothing else is a mirror of the card, so an edit to the
			-- card reaches it. NULL is no claim: an imported chat is a story by definition.
			seeded_greetings TEXT
		);

		CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			chat_id TEXT NOT NULL,
			parent_id TEXT,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			edited_at INTEGER,
			model TEXT,
			provider TEXT,
			tokens_prompt INTEGER,
			tokens_completion INTEGER,
			finish_reason TEXT,
			sibling_index INTEGER NOT NULL DEFAULT 0,
			thinking TEXT,
			-- The persona this turn was sent with, locked at send time. The active persona is
			-- global, so without it every past message re-attributes itself to the latest one.
			persona_id TEXT,
			-- { name, color } naming the divergent path this message heads.
			branch_label TEXT,
			attachments_json TEXT,
			generation_ms INTEGER,
			-- A typo fix does not advance edited_at, which memory reads as its staleness
			-- signal, so the touch is recorded here instead and the transcript still marks it.
			minor_edited_at INTEGER,
			sprite_label TEXT,
			first_token_ms INTEGER,
			reasoning_ms INTEGER,
			-- What the lorebook scan decided for the generation behind this turn: what reached
			-- the prompt, which keys pulled it in, and why an entry that could have fired did
			-- not. It hangs on the turn because a swipe is its own generation with its own rolls.
			lore_json TEXT,
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
			FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE SET NULL
		);
		CREATE INDEX idx_messages_parent ON messages(parent_id);
		CREATE INDEX idx_messages_chat ON messages(chat_id);

		CREATE TABLE settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);

		CREATE TABLE character_library (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL CHECK (type IN ('character', 'persona')),
			data_json TEXT NOT NULL,
			is_favorite INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX idx_character_library_type ON character_library(type);

		-- Named character variants. The entry's own data_json stays the ACTIVE variant's
		-- content, mirrored on every save, so every reader of the library works untouched.
		CREATE TABLE character_versions (
			id TEXT PRIMARY KEY,
			entry_id TEXT NOT NULL,
			name TEXT NOT NULL,
			data_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (entry_id) REFERENCES character_library(id) ON DELETE CASCADE
		);
		CREATE INDEX idx_character_versions_entry ON character_versions(entry_id);

		-- Standalone, so a book can be shared across entries, exported and re-imported on its
		-- own. Characters and personas link to one by id (data.lorebookIds).
		CREATE TABLE lorebooks (
			id TEXT PRIMARY KEY,
			data_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX idx_lorebooks_updated_at ON lorebooks(updated_at DESC);

		-- One note applies app-wide, to a character, to a single character version or to one
		-- chat. scope/scope_id are real columns so a chat delete can reap its own notes and a
		-- scope lookup is an index hit; no FK, since scope_id names a different table per
		-- scope and a dangling id is inert by design.
		CREATE TABLE steering_notes (
			id TEXT PRIMARY KEY,
			scope TEXT NOT NULL,
			scope_id TEXT,
			data_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX idx_steering_notes_scope ON steering_notes(scope, scope_id);

		CREATE TABLE memory_state (
			chat_id TEXT PRIMARY KEY,
			enabled INTEGER NOT NULL DEFAULT 0,
			config_json TEXT,
			updated_at INTEGER NOT NULL,
			-- 1 folds new turns into memory after each reply, 0 only on Process. It gates the
			-- extraction passes alone: branch-consistency roll-backs always run.
			auto_extract INTEGER NOT NULL DEFAULT 1,
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
		);

		-- The whole memory store. The archive boundary is deliberately not a column: it is
		-- derived on every read by tiling the active path with these episodes' own coverage,
		-- which is what lets the same rows answer differently on a branch.
		CREATE TABLE memory_episodes (
			id TEXT PRIMARY KEY,
			chat_id TEXT NOT NULL,
			layer INTEGER NOT NULL DEFAULT 0,
			content TEXT NOT NULL,
			source_message_ids TEXT,
			anchor_message_id TEXT,
			created_at INTEGER NOT NULL,
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
		);
		CREATE INDEX idx_memory_episodes_chat ON memory_episodes(chat_id, layer, created_at);

		CREATE TABLE assistant_sessions (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL DEFAULT 'New session',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			-- The full tool-calling conversation the assistant replays each turn, so it
			-- remembers what it found and did. Separate from the transcript below.
			context_json TEXT,
			chat_id TEXT,
			-- Historical Assistant settings, removed with this table by migration 45.
			settings_json TEXT
		);

		CREATE TABLE assistant_messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
			content TEXT NOT NULL,
			actions_json TEXT,
			error TEXT,
			created_at INTEGER NOT NULL,
			steps_json TEXT,
			usage_json TEXT,
			images_json TEXT,
			-- The row is written WHILE the turn runs, so it can outlive the process writing
			-- it: boot flips anything left running to interrupted, and durable tool effects
			-- are never left without a transcript naming them.
			status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('running', 'done', 'interrupted')),
			attachments_json TEXT,
			FOREIGN KEY (session_id) REFERENCES assistant_sessions(id) ON DELETE CASCADE
		);
		CREATE INDEX idx_assistant_messages_session ON assistant_messages(session_id, created_at);

		-- Files attached to an Assistant tab as reference material, read-only for their whole
		-- life, which is what makes a line number a permanent address. A file staged in the
		-- composer and never sent has message_id NULL, and that is the set the boot sweep acts on.
		CREATE TABLE assistant_files (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			message_id TEXT,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			bytes INTEGER NOT NULL,
			lines INTEGER NOT NULL,
			token_estimate INTEGER NOT NULL,
			-- The readable, normalized text, and the ONLY thing kept: it is what the
			-- assistant reads and what the viewer shows, the upload itself is still on the
			-- user's own disk, and a second stored copy of a 10 MB file would buy nothing.
			text_path TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			FOREIGN KEY (session_id) REFERENCES assistant_sessions(id) ON DELETE CASCADE,
			FOREIGN KEY (message_id) REFERENCES assistant_messages(id) ON DELETE CASCADE
		);
		CREATE INDEX idx_assistant_files_session ON assistant_files(session_id, created_at);

		-- Unsent composer text, one row per chat, so a draft follows the user across devices.
		CREATE TABLE chat_drafts (
			chat_id TEXT PRIMARY KEY,
			content TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
		);

		-- The composer's recall history, deliberately tied to neither messages nor chats:
		-- recall has to survive a message being deleted or its whole chat going away.
		CREATE TABLE input_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id TEXT,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);

		-- One row per named connection, so two connections can hit the same provider with
		-- different keys.
		CREATE TABLE connection_credentials (
			connection_id TEXT PRIMARY KEY,
			provider TEXT NOT NULL,
			api_key_encrypted TEXT NOT NULL,
			base_url TEXT,
			updated_at INTEGER NOT NULL
		);

		-- The prompt debug log, durable so it survives a restart and reaches devices that
		-- connect later. The entry is opaque JSON only server/promptLog.ts touches, and the
		-- cap prune on insert bounds it rather than anything here.
		CREATE TABLE prompt_log (
			id TEXT PRIMARY KEY,
			started_at INTEGER NOT NULL,
			entry TEXT NOT NULL
		);
		CREATE INDEX idx_prompt_log_started_at ON prompt_log(started_at);

		-- Every source file an import has already brought over, so running the same folder
		-- again adds what is new and duplicates nothing, which is also what makes a stopped
		-- import resumable with no resume machinery. The key is the path inside the picked
		-- folder namespaced by format, never a hash: a card edited on the other side is the
		-- same character arriving twice. entity_id is what the file became, NULL for the
		-- kinds nothing points back at.
		CREATE TABLE import_sources (
			source_key TEXT PRIMARY KEY,
			created_at INTEGER NOT NULL,
			entity_id TEXT
		);
		`
	},
	{
		version: 43,
		name: 'message_revisions',
		sql: `
		-- Per-chat revision counter and per-row stamp: every write to a messages row
		-- advances the chat's counter and carries the new value, so a device holding
		-- rev N can ask for what changed after N instead of the whole transcript.
		ALTER TABLE chats ADD COLUMN messages_rev INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE messages ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
		CREATE INDEX idx_messages_chat_rev ON messages(chat_id, rev);

		-- Deleted message ids with the rev the delete advanced to, so a delta can say
		-- what went away. A row is two ids and an integer, so nothing prunes these;
		-- deleting the chat cascades them.
		CREATE TABLE message_tombstones (
			chat_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			rev INTEGER NOT NULL,
			PRIMARY KEY (chat_id, message_id),
			FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
		);
		`
	},
	{
		version: 44,
		name: 'backfill_chat_default_version',
		sql: `
		-- What a new chat with a character is born pinned to is that character's own
		-- defaultVersionId, falling back to the FIRST variant ever made. No entry written
		-- before that field existed carries one, so without this a reader who forked a
		-- character months ago and moved the library onto the fork silently gets new chats
		-- on the original again. Their active pointer is the only honest record of the
		-- answer they had been getting, so it becomes the seed.
		--
		-- A row that already names a default is skipped: this never overwrites one, so a row
		-- that is already correct is untouched and a second run changes nothing. Skipped too:
		-- an unversioned character (nothing to pin), and one whose active pointer names a
		-- version that is gone, where the seed's own fallback is the truer answer than
		-- reviving a dead id. A data_json the JSON functions cannot parse is left exactly as
		-- it is; the library read is what fails loud on it.
		--
		-- The CASE guards are not decoration: json_extract RAISES on malformed JSON, and the
		-- order AND terms are evaluated in belongs to the query planner, so a bare
		-- json_valid() term beside them would be a boot that dies on somebody's torn row.
		UPDATE character_library
		SET data_json = json_set(data_json, '$.defaultVersionId', json_extract(data_json, '$.activeVersionId'))
		WHERE type = 'character'
		  AND json_valid(data_json)
		  AND CASE WHEN json_valid(data_json) THEN json_extract(data_json, '$.defaultVersionId') END IS NULL
		  AND EXISTS (
		    SELECT 1 FROM character_versions v
		    WHERE v.entry_id = character_library.id
		      AND v.id = CASE WHEN json_valid(character_library.data_json)
		                      THEN json_extract(character_library.data_json, '$.activeVersionId') END
		  );
		`
	},
	{
		version: 45,
		name: 'remove_chungus_assistant_storage',
		sql: `
		-- These keys belonged only to the removed Chungus Assistant. Guard every JSON
		-- function with CASE: malformed settings must not turn a cleanup into a failed boot.
		UPDATE settings
		SET value = CASE WHEN json_valid(value)
		                 THEN json_remove(value, '$.assistantLauncher', '$.assistantCostSeen')
		                 ELSE value END
		WHERE key = 'generalSettings'
		  AND CASE WHEN json_valid(value)
		           THEN json_type(value, '$.assistantLauncher') IS NOT NULL
		             OR json_type(value, '$.assistantCostSeen') IS NOT NULL
		           ELSE 0 END;

		UPDATE settings
		SET value = CASE WHEN json_valid(value)
		                 THEN json_remove(value, '$.assistant')
		                 ELSE value END
		WHERE key = 'connectionAssignments'
		  AND CASE WHEN json_valid(value)
		           THEN json_type(value, '$.assistant') IS NOT NULL
		           ELSE 0 END;

		-- Child tables first: both carry foreign keys into the session table, and files
		-- also point at messages. Their indexes disappear with their owning tables.
		DROP TABLE assistant_files;
		DROP TABLE assistant_messages;
		DROP TABLE assistant_sessions;
		`
	},
	{
		version: 46,
		name: 'message_prompt_exclusion',
		sql: `ALTER TABLE messages ADD COLUMN excluded_from_prompt INTEGER NOT NULL DEFAULT 0;`
	},
	{
		version: 47,
		name: 'manual_memory_scenes',
		sql: `CREATE TABLE memory_scenes (
			id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			title TEXT NOT NULL, content TEXT NOT NULL, source_json TEXT NOT NULL,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			revision INTEGER NOT NULL DEFAULT 1, review_reason TEXT
		);
		CREATE INDEX idx_memory_scenes_chat ON memory_scenes(chat_id);
		CREATE TABLE memory_scene_migrations (
			chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE
		);`
	},
	{
		version: 48,
		name: 'memory_arcs_volumes',
		sql: `ALTER TABLE memory_scenes ADD COLUMN level TEXT NOT NULL DEFAULT 'chapter' CHECK (level IN ('chapter', 'arc', 'volume'));
		ALTER TABLE memory_scenes ADD COLUMN children_json TEXT NOT NULL DEFAULT '[]';`
	},
	{
		version: 49,
		name: 'threads_engine',
		sql: `CREATE TABLE threads_rounds (
			id TEXT PRIMARY KEY,
			chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			data_json TEXT NOT NULL
		);
		CREATE INDEX idx_threads_rounds_chat ON threads_rounds(chat_id, created_at);
		CREATE TABLE threads_notes (
			chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
			notes TEXT NOT NULL DEFAULT '',
			ao3_json TEXT NOT NULL DEFAULT '{}'
		);`
	},
	{
		version: 50,
		name: 'threads_chat_prompt',
		sql: `ALTER TABLE threads_notes ADD COLUMN prompt_id TEXT;`
	},
	{
		version: 51,
		name: 'message_bookmarks',
		sql: `ALTER TABLE messages ADD COLUMN is_bookmarked INTEGER NOT NULL DEFAULT 0;`
	}
];

/** The newest schema this build can produce. A snapshot recording a higher one was written
 *  by a newer app and cannot be restored here, since migrations only ever run forward. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
/** Oldest database format for which this build still has a complete migration path. */
export const BASELINE_SCHEMA_VERSION = MIGRATIONS[0]?.version ?? 0;

/**
 * Exported for the two tests that need a schema without booting a server: `schema-upgrade.test.ts`,
 * which holds every migration to what a migration is allowed to do, and `backup/backup.test.ts`,
 * which needs real tables to snapshot. Nothing else may import this.
 */
export const MIGRATIONS_FOR_TESTS: readonly Migration[] = MIGRATIONS;

/**
 * The schema version of the database file as it sits on disk, read through a throwaway
 * read-only connection so nothing has to open the live handle first. That ordering is the
 * whole reason it exists: the pre-upgrade snapshot has to be taken BEFORE `serverDb.open()`,
 * and opening is what runs the very migrations the snapshot exists to protect against.
 *
 * 0 means there is nothing to protect: no file, or a file no migration has touched yet.
 */
export function schemaVersionOnDisk(): number {
	const path = resolveDbPath();
	if (!existsSync(path)) return 0;
	let probe: Database | null = null;
	try {
		probe = new Database(path, { readonly: true });
		const row = probe.query('SELECT MAX(version) AS v FROM _migrations').get() as {
			v: number | null;
		} | null;
		return row?.v ?? 0;
	} catch {
		// No `_migrations` table, so no applied schema to snapshot. A file that is broken
		// rather than young says so loudly moments later, when open() runs for real.
		return 0;
	} finally {
		probe?.close();
	}
}

class ServerDatabase {
	private _db: Database | null = null;

	/**
	 * Opened on first use, resolving the data dir from the env at that moment rather than
	 * at import time. Import order must not decide which database file this process
	 * writes: test files load server modules in arbitrary order and pin
	 * CHUNGUS_DATA_DIR to a throwaway dir before their first db call, and a path frozen
	 * at import would silently point those writes at the real user-data instead.
	 * The server calls open() at boot so a broken database still fails at startup.
	 */
	private get db(): Database {
		if (!this._db) {
			this._db = new Database(resolveDbPath(), { create: true });
			this._db.exec('PRAGMA journal_mode = WAL');
			this._db.exec('PRAGMA foreign_keys = ON');
			this.runMigrations();
		}
		return this._db;
	}

	/** Force the lazy handle open now (fail-fast at server boot). */
	open(): void {
		void this.db;
	}

	/**
	 * Release the handle so the next use reopens against whatever CHUNGUS_DATA_DIR names
	 * then. One process holds one database, so a test file that pins its own throwaway dir
	 * calls this in beforeAll to bind to it, and in afterAll before deleting the dir: an
	 * open handle over a deleted file fails every later statement in the run with
	 * SQLITE_IOERR_VNODE, in whichever file happens to run next.
	 *
	 * Not a shutdown hook. Calling it under a live server faults whatever is mid-statement.
	 */
	closeForTests(): void {
		this._db?.close();
		this._db = null;
	}

	/** Highest migration applied to the open database. */
	schemaVersion(): number {
		const row = this.db.query('SELECT MAX(version) AS v FROM _migrations').get() as {
			v: number | null;
		} | null;
		return row?.v ?? 0;
	}

	/**
	 * What has been made since a moment, for the restore confirmation to state in real
	 * numbers. Messages are counted beside chats and characters because they are the actual
	 * work: a restore that costs "1 chat" can cost four hours of writing inside it.
	 *
	 * Deliberately not bridged: the only caller is the restore path, in this process.
	 */
	createdSince(at: number): { chats: number; messages: number; characters: number } {
		const one = (sql: string): number => (this.db.query(sql).get(at) as { n: number }).n;
		return {
			chats: one('SELECT COUNT(*) AS n FROM chats WHERE created_at > ?'),
			messages: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?'),
			characters: one(
				"SELECT COUNT(*) AS n FROM character_library WHERE created_at > ? AND type = 'character'"
			)
		};
	}

	private runMigrations(): void {
		this.db.exec(
			'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'
		);
		const appliedRows = this.db.query('SELECT version FROM _migrations').all() as { version: number }[];
		const applied = new Set(appliedRows.map((r) => r.version));

		for (const migration of MIGRATIONS.sort((a, b) => a.version - b.version)) {
			if (applied.has(migration.version)) continue;
			console.log(`[db] applying migration ${migration.version}: ${migration.name}`);
			const tx = this.db.transaction(() => {
				this.db.exec(migration.sql);
				this.db.run('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)', [
					migration.version,
					migration.name,
					Date.now()
				]);
			});
			tx();
		}
	}

	private select<T>(sql: string, params: unknown[] = []): T {
		return this.db.query(sql).all(...(params as never[])) as T;
	}

	/** Answers how many rows the statement changed, for the writers that have to refuse a
	 *  row that was not there. */
	private execute(sql: string, params: unknown[] = []): number {
		return this.db.query(sql).run(...(params as never[])).changes;
	}

	/** Run several writes atomically: any throw rolls back everything. Nests via
	 *  savepoints, so callees that open their own transaction stay safe inside. */
	inTransaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	// ===== MAPPERS (DB rows -> camelCase domain objects the client expects) =====

	private mapChat(row: Record<string, unknown>): unknown {
		return {
			id: row.id,
			title: row.title,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			rootMessageId: row.root_message_id,
			activeLeafId: row.active_leaf_id,
			canonLeafId: row.canon_leaf_id ?? null,
			settings: row.settings_json ? JSON.parse(row.settings_json as string) : null,
			characterId: row.character_id ?? null,
			characterVersionId: row.character_version_id ?? null,
			isFavorite: !!row.is_favorite,
			// Opaque, deliberately NOT JSON.parsed here (unlike settings/branchLabel
			// above): a corrupt blob must not fail this row's read (and getAllChats maps
			// every chat in one query, so it must not fail ALL of them either). The
			// client's normalizeChatFeatureState is the only reader.
			featureState: row.feature_state ?? null
		};
	}

	private mapMessage(row: Record<string, unknown>): unknown {
		return {
			id: row.id,
			chatId: row.chat_id,
			parentId: row.parent_id,
			role: row.role,
			content: row.content,
			excludedFromPrompt: row.excluded_from_prompt === 1,
			isBookmarked: row.is_bookmarked === 1,
			personaId: row.persona_id ?? null,
			branchLabel: row.branch_label ? JSON.parse(row.branch_label as string) : null,
			thinking: row.thinking ?? null,
			attachments: row.attachments_json ? JSON.parse(row.attachments_json as string) : null,
			createdAt: row.created_at,
			editedAt: row.edited_at,
			minorEditedAt: row.minor_edited_at ?? null,
			spriteLabel: row.sprite_label ?? null,
			model: row.model,
			provider: row.provider,
			tokensPrompt: row.tokens_prompt,
			tokensCompletion: row.tokens_completion,
			finishReason: row.finish_reason,
			generationMs: row.generation_ms,
			firstTokenMs: row.first_token_ms ?? null,
			reasoningMs: row.reasoning_ms ?? null,
			// Parsed defensively: this is a debug record, and a corrupt cell must never cost
			// the reader the transcript it is attached to. A row that will not parse reads as
			// a turn nobody traced.
			lorebook: parseJsonColumn(row.lore_json),
			siblingIndex: row.sibling_index
		};
	}

	// ===== CHATS =====

	getAllChats(): unknown[] {
		const rows = this.select<Record<string, unknown>[]>(
			'SELECT * FROM chats ORDER BY updated_at DESC'
		);
		return rows.map((r) => this.mapChat(r));
	}

	getChat(id: string): unknown {
		const rows = this.select<Record<string, unknown>[]>('SELECT * FROM chats WHERE id = ?', [id]);
		return rows[0] ? this.mapChat(rows[0]) : null;
	}

	insertChat(chat: NewChatRow): void {
		this.execute(
			`INSERT INTO chats (id, title, created_at, updated_at, root_message_id, active_leaf_id, canon_leaf_id, settings_json, character_id, character_version_id, feature_state, is_favorite)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				chat.id,
				chat.title,
				chat.createdAt,
				chat.updatedAt,
				chat.rootMessageId,
				chat.activeLeafId,
				chat.canonLeafId ?? null,
				chat.settings ? JSON.stringify(chat.settings) : null,
				chat.characterId ?? null,
				chat.characterVersionId ?? null,
				chat.featureState ?? null,
				chat.isFavorite ? 1 : 0
			]
		);
	}

	/** Star/unstar a chat. Never touches updated_at: favoriting is bookkeeping, not
	 *  activity, and must not reshuffle an activity-sorted list under the user. */
	updateChatFavorite(chatId: string, isFavorite: boolean): void {
		this.execute('UPDATE chats SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, chatId]);
	}

	/**
	 * Deep-copy a chat into a new one and return its id. Whole thing in one transaction:
	 * a half-copied story is worse than none.
	 *
	 * What rides along, and why: the entire message forest (every swipe, alternate
	 * greeting and abandoned fork; a copy of only the read branch is a different
	 * story), branch labels, the canon and active-leaf pointers, the pinned character
	 * version, and the feature state (steering + impersonate). Message timestamps are
	 * kept so the transcript reads identically; the chat's OWN created/updated are
	 * stamped now, because the copy is a new thing in the list. Attachment paths are
	 * copied verbatim: chat images are reference-counted (see dropOrphanedChatImages),
	 * so two rows sharing one file is the designed state, not a leak.
	 *
	 * Deliberately NOT copied: the favorite flag (a star is about the original) and the
	 * composer draft (unsent text belongs to where it was typed). Memory is opt-in:
	 * the caller asks the user first, see getChatMemoryFootprint.
	 */
	duplicateChat(options: { chatId: string; title: string; includeMemory: boolean }): string {
		return this.copyChat(options);
	}

	/** A separate conversation containing only the selected turn and its ancestors. */
	branchChat(options: { chatId: string; messageId: string; title: string; content: string }): string {
		return this.copyChat({ ...options, includeMemory: true, branch: options });
	}

	private copyChat(options: {
		chatId: string; title: string; includeMemory: boolean;
		branch?: { messageId: string; content: string };
	}): string {
		const { chatId, title, includeMemory } = options;
		const { branch } = options;
		return this.inTransaction(() => {
			const source = this.select<Record<string, unknown>[]>('SELECT * FROM chats WHERE id = ?', [chatId])[0];
			if (!source) throw new Error(`duplicateChat: no chat with id ${chatId}`);

			let rows = this.select<Record<string, unknown>[]>('SELECT * FROM messages WHERE chat_id = ?', [chatId]);
			if (branch) {
				if (typeof branch.content !== 'string' || !branch.content.trim()) throw new Error('branchChat: message content is empty');
				const byId = new Map(rows.map(row => [row.id as string, row]));
				const path: Record<string, unknown>[] = [];
				const seen = new Set<string>();
				for (let id: string | null = branch.messageId; id !== null; ) {
					const row = byId.get(id);
					if (!row || seen.has(id)) throw new Error('branchChat: source message or its history is unavailable');
					seen.add(id);
					path.push(row);
					id = row.parent_id as string | null;
				}
				if (!path.length) throw new Error('branchChat: no source message');
				rows = path.reverse();
			}
			const idMap = new Map<string, string>();
			for (const row of rows) idMap.set(row.id as string, randomUUID());
			const remap = (id: unknown): string | null => (typeof id === 'string' ? (idMap.get(id) ?? null) : null);

			const newChatId = randomUUID();
			const now = Date.now();
			// Chat row first (messages.chat_id is a real FK), its pointers last, the same
			// ordering createChat -> seedCharacterGreetings uses, for the same reason.
			this.execute(
				`INSERT INTO chats (id, title, created_at, updated_at, root_message_id, active_leaf_id, canon_leaf_id, settings_json, character_id, character_version_id, feature_state, seeded_greetings, is_favorite)
				 VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, 0)`,
				[
					newChatId,
					title,
					now,
					now,
					source.settings_json ?? null,
					source.character_id ?? null,
					source.character_version_id ?? null,
					source.feature_state ?? null,
					// A full duplicate keeps the greeting claim. An explicit branch owns its
					// copied opening, including a one-turn branch, rather than following card edits.
					branch ? null : source.seeded_greetings ?? null
				]
			);

			// Parent-first: messages.parent_id is a real FK, so a child can never land
			// before its parent. BFS from the roots reaches every node exactly once.
			const children = new Map<string | null, Record<string, unknown>[]>();
			for (const row of rows) {
				const key = (row.parent_id as string | null) ?? null;
				const bucket = children.get(key);
				if (bucket) bucket.push(row);
				else children.set(key, [row]);
			}
			const queue = [...(children.get(null) ?? [])];
			let copied = 0;
			while (queue.length) {
				const row = queue.shift()!;
				const content = branch && branch.messageId === row.id ? branch.content : row.content;
				const edited = content !== row.content;
				copied += 1;
				// No rev stamp: the copy is a fresh chat id no device holds a rev for, so its
				// rows rest at 0 and the first open reads them full like any other chat.
				this.execute(
					`INSERT INTO messages
					 (id, chat_id, parent_id, role, content, persona_id, branch_label, thinking, attachments_json, created_at, edited_at, minor_edited_at, sprite_label,
					  model, provider, tokens_prompt, tokens_completion, finish_reason, generation_ms, first_token_ms, reasoning_ms, lore_json, sibling_index, excluded_from_prompt, is_bookmarked)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						idMap.get(row.id as string),
						newChatId,
						remap(row.parent_id),
						row.role,
						content,
						row.persona_id ?? null,
						row.branch_label ?? null,
						row.thinking ?? null,
						row.attachments_json ?? null,
						row.created_at,
						edited ? now : row.edited_at ?? null,
						row.minor_edited_at ?? null,
						row.sprite_label ?? null,
						row.model ?? null,
						row.provider ?? null,
						row.tokens_prompt ?? null,
						row.tokens_completion ?? null,
						row.finish_reason ?? null,
						row.generation_ms ?? null,
						row.first_token_ms ?? null,
						row.reasoning_ms ?? null,
						row.lore_json ?? null,
						row.sibling_index,
						row.excluded_from_prompt ?? 0,
						row.is_bookmarked ?? 0
					]
				);
				queue.push(...(children.get(row.id as string) ?? []));
			}
			// Every row must be reachable from a root (a deleted parent NULLs its children
			// into roots, so it always is). If that ever stops holding, a silent partial
			// copy would look like a successful one. Refuse instead.
			if (copied !== rows.length) {
				throw new Error(`duplicateChat: ${rows.length - copied} message(s) unreachable from a root in chat ${chatId}`);
			}

			this.execute(
				'UPDATE chats SET root_message_id = ?, active_leaf_id = ?, canon_leaf_id = ? WHERE id = ?',
				branch
					? [remap(rows[0].id), remap(branch.messageId), remap(branch.messageId), newChatId]
					: [remap(source.root_message_id), remap(source.active_leaf_id), remap(source.canon_leaf_id), newChatId]
			);

			// Chat-scoped steering notes are part of what makes the copy the same story:
			// each is re-minted under a fresh id, bound to the new chat. Notes at the
			// global/character/version scopes are untouched: they already apply to the
			// copy through their own binding, and copying them would double-inject.
			const notes = this.select<{ id: string; data_json: string; created_at: number; updated_at: number }[]>(
				"SELECT * FROM steering_notes WHERE scope = 'chat' AND scope_id = ?",
				[chatId]
			);
			for (const note of notes) {
				this.execute(
					"INSERT INTO steering_notes (id, scope, scope_id, data_json, created_at, updated_at) VALUES (?, 'chat', ?, ?, ?, ?)",
					[randomUUID(), newChatId, note.data_json, note.created_at, note.updated_at]
				);
			}

			if (includeMemory) this.copyChatMemory(chatId, newChatId, idMap, !!branch);
			const threadMessageIds = new Map(idMap);
			// Threads have no review state: do not inherit reactions to the ending the
			// reader just rewrote. Memory retains its fingerprint-based review instead.
			if (branch && rows.at(-1)?.content !== branch.content) threadMessageIds.delete(branch.messageId);
			this.copyChatThreads(chatId, newChatId, threadMessageIds);
			return newChatId;
		});
	}

	/** Threads are copied independently of the optional Chat Memory payload. */
	private copyChatThreads(fromChatId: string, toChatId: string, messageIds: Map<string, string>): void {
		const data = this.getThreadsData(fromChatId);
		for (const round of inheritThreadsRounds(data.rounds, toChatId, messageIds, randomUUID)) this.writeThreadsRound(round);
		const notes = this.select<{ notes: string; ao3_json: string; prompt_id: string | null }[]>('SELECT notes, ao3_json, prompt_id FROM threads_notes WHERE chat_id = ?', [fromChatId])[0];
		if (notes) this.execute('INSERT INTO threads_notes (chat_id, notes, ao3_json, prompt_id) VALUES (?, ?, ?, ?)', [toChatId, notes.notes, notes.ao3_json, notes.prompt_id]);
	}

	/** Carry a chat's memory across to a duplicate. Every message reference is remapped
	 *  through the same map the message copy used, and episode cross-references through
	 *  their own fresh-id map: memory still pointing at the original's rows would resolve
	 *  its coverage against a tree it no longer belongs to. Runs inside the chat copy's
	 *  transaction. */
	private copyChatMemory(fromChatId: string, toChatId: string, messageIds: Map<string, string>, onlyComplete = false): void {
		const sourceScenes = this.getMemoryScenes(fromChatId).filter(scene =>
			!onlyComplete || (scene.source.length > 0 && scene.source.every(entry => messageIds.has(entry.id)))
		);
		const sceneIds = new Map(sourceScenes.map(scene => [scene.id, randomUUID()]));
		const oldScenes = new Map(sourceScenes.map(scene => [scene.id, scene]));
		for (const scene of sourceScenes) {
			const source = scene.source.map((entry) => ({ ...entry, id: messageIds.get(entry.id) ?? `missing:${randomUUID()}` }));
			const children = (scene.children ?? []).map(ref => ({ id: sceneIds.get(ref.id) ?? `missing:${randomUUID()}`,
				revision: oldScenes.get(ref.id)?.revision === ref.revision ? 1 : 0 }));
			this.execute('INSERT INTO memory_scenes (id, chat_id, title, content, source_json, created_at, updated_at, revision, review_reason, level, children_json) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
				[sceneIds.get(scene.id)!, toChatId, scene.title, scene.content, JSON.stringify(source), scene.createdAt, Date.now(), scene.reviewReason, sceneLevel(scene), JSON.stringify(children)]);
		}
		this.execute('INSERT INTO memory_scene_migrations (chat_id) VALUES (?)', [toChatId]);
		// Retain compatible legacy rows for backup/older tools. Stale rows have already been
		// preserved as reviewable scenes above and must not block copying the conversation.

		const remapMsgId = (id: string): string => {
			const mapped = messageIds.get(id);
			if (!mapped) throw new Error('mem-copy-stale: memory points at a message that is gone');
			return mapped;
		};
		const remapMsg = (id: unknown): string | null => (typeof id === 'string' ? remapMsgId(id) : null);
		const remapMsgList = (json: unknown): string | null => {
			if (typeof json !== 'string') return null;
			const parsed = JSON.parse(json) as unknown;
			if (!Array.isArray(parsed)) return null;
			return JSON.stringify(parsed.filter((id): id is string => typeof id === 'string').map(remapMsgId));
		};

		const state = this.select<Record<string, unknown>[]>('SELECT * FROM memory_state WHERE chat_id = ?', [fromChatId])[0];
		if (state) {
			this.execute(
				'INSERT INTO memory_state (chat_id, enabled, config_json, updated_at, auto_extract) VALUES (?, ?, ?, ?, ?)',
				[toChatId, state.enabled, state.config_json ?? null, Date.now(), state.auto_extract]
			);
		}

		// ORDER BY rowid: the copy's rows are re-inserted in the order they come back, and
		// Legacy episode reads break created_at ties by rowid, so reading in index order would
		// silently re-order same-millisecond rows in the copy. Historical insertion order
		// must survive ties; see architecture/memory.md.
		const episodes = this.select<Record<string, unknown>[]>('SELECT * FROM memory_episodes WHERE chat_id = ? ORDER BY rowid', [fromChatId]);
		for (const episode of episodes) {
			let refs: string[];
			try { const value = JSON.parse(String(episode.source_message_ids ?? '[]')); if (!Array.isArray(value)) continue; refs = value.filter((id): id is string => typeof id === 'string'); } catch { continue; }
			if (refs.some((id) => !messageIds.has(id)) || (typeof episode.anchor_message_id === 'string' && !messageIds.has(episode.anchor_message_id))) continue;
			this.execute(
				`INSERT INTO memory_episodes (id, chat_id, layer, content, source_message_ids, anchor_message_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					toChatId,
					episode.layer,
					episode.content,
					remapMsgList(episode.source_message_ids),
					remapMsg(episode.anchor_message_id),
					episode.created_at
				]
			);
		}
	}

	updateChat(chat: Record<string, unknown> & { id: string }, options: { touchUpdatedAt?: boolean } = {}): void {
		const { touchUpdatedAt = false } = options;
		const updates: string[] = [];
		const values: unknown[] = [];

		if (chat.title !== undefined) {
			updates.push('title = ?');
			values.push(chat.title);
		}
		if (chat.rootMessageId !== undefined) {
			updates.push('root_message_id = ?');
			values.push(chat.rootMessageId);
		}
		if (chat.activeLeafId !== undefined) {
			updates.push('active_leaf_id = ?');
			values.push(chat.activeLeafId);
		}
		if (chat.canonLeafId !== undefined) {
			updates.push('canon_leaf_id = ?');
			values.push(chat.canonLeafId ?? null);
		}
		if (chat.settings !== undefined) {
			updates.push('settings_json = ?');
			values.push(chat.settings ? JSON.stringify(chat.settings) : null);
		}
		if (chat.characterId !== undefined) {
			updates.push('character_id = ?');
			values.push(chat.characterId ?? null);
		}
		if (chat.characterVersionId !== undefined) {
			updates.push('character_version_id = ?');
			values.push(chat.characterVersionId ?? null);
		}
		if (chat.featureState !== undefined) {
			// Opaque passthrough, like settings.value: the caller already sends a
			// JSON string (or null); this never parses or re-serializes it.
			updates.push('feature_state = ?');
			values.push(chat.featureState ?? null);
		}

		if (touchUpdatedAt) {
			updates.push('updated_at = ?');
			values.push(Date.now());
		}
		if (updates.length === 0) return;
		values.push(chat.id);

		if (chat.activeLeafId === undefined) {
			this.execute(`UPDATE chats SET ${updates.join(', ')} WHERE id = ?`, values);
		} else {
			this.inTransaction(() => {
				this.execute(`UPDATE chats SET ${updates.join(', ')} WHERE id = ?`, values);
				this.pruneOldReasoning(chat.id);
			});
		}
	}

	updateChatActiveLeaf(chatId: string, leafId: string | null, options: { touchUpdatedAt?: boolean } = {}): void {
		if (leafId !== null && !this.select<{ id: string }[]>(
			'SELECT id FROM messages WHERE id = ? AND chat_id = ?', [leafId, chatId]
		).length) throw new Error('The selected response no longer exists in this chat.');
		this.updateChat({ id: chatId, activeLeafId: leafId }, options);
	}

	touchChatActivity(chatId: string): void {
		this.execute('UPDATE chats SET updated_at = ? WHERE id = ?', [Date.now(), chatId]);
	}

	/**
	 * Land a generated assistant turn: the row, the chat's pointers, and the one-shot steering
	 * notes that rode it, in ONE transaction.
	 *
	 * It exists because a generation outlives the page that asked for it (architecture/server-core.md),
	 * so the answer has to be written by the side that is still there. It is a single method for
	 * the reason every whole-write here is one: `bun:sqlite` is synchronous, so nothing can
	 * interleave inside a transaction, and that is exactly what keeps a concurrent delete from
	 * repairing the chat's pointers around a row this is still inserting.
	 *
	 * Two guards, and both are about a turn that outlived its reader's session:
	 *
	 * A **missing chat** answers null rather than throwing. The story was deleted while the
	 * model was writing; there is nothing to land and nothing that went wrong.
	 *
	 * The **leaf only moves when it still names what the request left it on**. Client-side this
	 * could not come up, because the composer is locked for the length of a generation. Here the
	 * reader can reload, walk to another branch and play five more turns before this lands, and
	 * yanking them back to a reply on the branch they left would be worse than the reply simply
	 * appearing as a sibling they can swipe to.
	 *
	 * A **missing parent throws**: the FK would refuse the insert anyway, and a turn with nowhere
	 * to hang is a real failure rather than a race to absorb quietly.
	 */
	commitGeneratedTurn(commit: {
		chatId: string;
		/** The row the turn hangs under; null lands a root sibling (an opening scene). */
		parentId: string | null;
		/** What `active_leaf_id` was when the request went out. The leaf moves only if it
		 *  still reads that, so a reader who moved on in the meantime is left where they are. */
		expectedLeafId: string | null;
		/** Opening scene only: claim `root_message_id` when the chat holds none. That pointer
		 *  names the chat's FIRST root, so an opening written beside existing greetings must
		 *  not renumber which of them that is. */
		claimsRoot: boolean;
		content: string;
		thinking: string | null;
		model: string;
		provider: string;
		tokensPrompt: number | null;
		tokensCompletion: number | null;
		finishReason: string | null;
		generationMs: number | null;
		firstTokenMs: number | null;
		reasoningMs: number | null;
		/** The lorebook scan that shaped this turn. Carried verbatim, never interpreted. */
		lorebook: unknown;
		/** Ids of the 'once' steering notes this turn's prompt resolved. Spent here rather
		 *  than by the caller so a page that never comes back cannot leave guidance armed to
		 *  apply itself twice (architecture/chat-sessions.md). */
		spendSteeringIds: string[];
		replaceMessageIds?: string[];
	}): { messageId: string; spentSteeringIds: string[] } | null {
		const removedImages: string[] = [];
		const landed = this.inTransaction(() => {
			const chat = this.select<{ active_leaf_id: string | null; root_message_id: string | null }[]>(
				'SELECT active_leaf_id, root_message_id FROM chats WHERE id = ?',
				[commit.chatId]
			)[0];
			if (!chat) return null;
			if (commit.replaceMessageIds?.length && (commit.finishReason === 'cancelled' || !commit.content.trim())) return null;
			const replacements = [...new Set(commit.replaceMessageIds ?? [])];
			for (const id of replacements) {
				const old = this.getMessage(id) as { chatId: string; parentId: string | null } | null;
				if (old && (old.chatId !== commit.chatId || old.parentId !== commit.parentId)) {
					throw new Error('Replacement must name alternatives of the generated reply.');
				}
			}

			if (commit.parentId) {
				const parent = this.select<{ id: string }[]>('SELECT id FROM messages WHERE id = ? AND chat_id = ?', [commit.parentId, commit.chatId]);
				if (!parent[0]) {
					throw new Error(
						`commitGeneratedTurn: parent ${commit.parentId} is gone or belongs to another chat, so the generated turn has nowhere to hang.`
					);
				}
			}

			const messageId = randomUUID();
			this.insertMessage({
				id: messageId,
				chatId: commit.chatId,
				parentId: commit.parentId,
				// Stamped here rather than taken from the caller, for the same reason
				// `insertAssistantMessage` stamps its own: the user's turn was written by a
				// browser and this one by the server, and letting each supply its own clock puts
				// a reply ahead of the message it answers whenever the two drift.
				createdAt: Date.now(),
				role: 'assistant',
				content: commit.content,
				thinking: commit.thinking,
				model: commit.model,
				provider: commit.provider,
				tokensPrompt: commit.tokensPrompt,
				tokensCompletion: commit.tokensCompletion,
				finishReason: commit.finishReason,
				generationMs: commit.generationMs,
				firstTokenMs: commit.firstTokenMs,
				reasoningMs: commit.reasoningMs,
				lorebook: commit.lorebook,
				siblingIndex: this.getNextSiblingIndex(commit.chatId, commit.parentId)
			});

			const pointers: Record<string, unknown> & { id: string } = { id: commit.chatId };
			if (chat.active_leaf_id === commit.expectedLeafId) pointers.activeLeafId = messageId;
			if (commit.claimsRoot && !chat.root_message_id) pointers.rootMessageId = messageId;
			this.updateChat(pointers, { touchUpdatedAt: true });

			// Insert and remove in one transaction, including tombstones for every device.
			// Files are cleaned only after commit, so a rollback cannot erase live attachments.
			for (const id of replacements) {
				const doomed = this.descendantIds(id, true);
				if (!doomed.length) continue;
				removedImages.push(...this.imagePathsOfMessages(doomed));
				this.recordMessageTombstones(commit.chatId, doomed, this.bumpMessagesRev(commit.chatId));
				this.execute(`WITH RECURSIVE descendants AS (
					SELECT id FROM messages WHERE id = ?
					UNION ALL SELECT m.id FROM messages m INNER JOIN descendants d ON m.parent_id = d.id
				) DELETE FROM messages WHERE id IN (SELECT id FROM descendants)`, [id]);
				this.repairChatPointers(commit.chatId, new Set(doomed), commit.parentId);
			}

			// Disable only the one-shot guidance this prompt used, in the reply transaction.
			const spentSteeringIds = this.consumeSteeringNotes(commit.spendSteeringIds);
			if (pointers.activeLeafId === undefined) this.pruneOldReasoning(commit.chatId);

			return { messageId, spentSteeringIds };
		});
		this.dropOrphanedChatImages(removedImages);
		return landed;
	}

	// ===== Chat image attachments (files under images/chat/) =====
	//
	// A deleted chat or message must leave nothing behind on disk: the user deleted it, so
	// its pictures are gone too. Two rules make that safe.
	//
	//  1. Branching/forking copies attachment lists. Cleanup checks all persisted owners,
	//     including versions and presets, AFTER the deleted rows are gone.
	//  2. images/chat/ only. Character and persona art lives in its own folder and is
	//     always a copy (see edit_character_images), never an alias of a chat attachment.
	//     This sweep refuses to touch anything outside images/chat/, so deleting a chat
	//     can never blank a portrait that came from it.

	/** The image paths one attachments_json blob references. */
	private imagePathsIn(json: string | null): string[] {
		if (!json) return [];
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((item) => (typeof item === 'string' ? item : (item as { kind?: string; path?: string })?.path))
			.filter((p): p is string => typeof p === 'string' && p.length > 0);
	}

	private imagePathsOfChat(chatId: string): string[] {
		const rows = this.select<{ attachments_json: string | null }[]>('SELECT attachments_json FROM messages WHERE chat_id = ?', [chatId]);
		return rows.flatMap((r) => this.imagePathsIn(r.attachments_json));
	}

	private imagePathsOfMessages(messageIds: string[]): string[] {
		if (!messageIds.length) return [];
		const holes = messageIds.map(() => '?').join(', ');
		const rows = this.select<{ attachments_json: string | null }[]>(`SELECT attachments_json FROM messages WHERE id IN (${holes})`, messageIds);
		return rows.flatMap((r) => this.imagePathsIn(r.attachments_json));
	}

	/** Ids of a message and everything under it, so their files can be collected first. */
	private descendantIds(messageId: string, includeSelf: boolean): string[] {
		const seed = includeSelf ? 'SELECT id FROM messages WHERE id = ?' : 'SELECT id FROM messages WHERE parent_id = ?';
		const rows = this.select<{ id: string }[]>(
			`WITH RECURSIVE descendants AS (
				${seed}
				UNION ALL
				SELECT m.id FROM messages m
				INNER JOIN descendants d ON m.parent_id = d.id
			)
			SELECT id FROM descendants`,
			[messageId]
		);
		return rows.map((r) => r.id);
	}

	/** Deletes every candidate file no surviving row points at. Call AFTER the rows are gone. */
	private dropOrphanedChatImages(paths: string[]): void {
		if (!paths.length) return;
		let referenced: Set<string>;
		try { referenced = this.imageReferences(); }
		catch (error) { console.error('[db] image cleanup skipped:', error); return; }
		for (const path of new Set(paths)) {
			// The one folder this sweep owns. Entry art is never reachable from here.
			if (!path.startsWith('images/chat/')) continue;
			if (referenced.has(imageReferenceKey(path))) continue;
			try { deleteImage(path); }
			catch (error) { console.error('[db] image cleanup failed:', error); }
		}
	}

	private imageReferences(): Set<string> {
		const references = new Set([...referencedImagePaths(this.db, true), ...referencedPresetImages()]);
		for (const path of [...references]) {
			if (/\/thumbnails\//i.test(path)) {
				const original = path.replace(/\/thumbnails\//i, '/').replace(/\.[^.]+$/, '');
				for (const extension of IMAGE_EXTENSIONS) references.add(original + extension);
			}
		}
		return new Set([...references].map(imageReferenceKey));
	}

	/** Cleanup requests never delete a file another persisted owner still names. */
	deleteUnusedImage(path: string): boolean {
		if (this.imageReferences().has(imageReferenceKey(path))) return false;
		deleteImage(path); return true;
	}

	/**
	 * Boot-time GC for images/chat/: an upload whose send was abandoned (composer closed,
	 * tab discarded) is referenced by no row and reachable by no sweep, so it would sit on
	 * disk forever. Runs once at server start; the one-hour age guard protects uploads a
	 * client staged moments before a restart. Thumbnails ride with their originals.
	 */
	sweepAbandonedChatImages(): number {
		const dir = join(IMAGES_ROOT, 'chat');
		if (!existsSync(dir)) return 0;
		if (lstatSync(dir).isSymbolicLink()) return 0;
		const cutoff = Date.now() - 60 * 60 * 1000;
		// Every path any message references, parsed from the real rows.
		// No LIKE guessing here, this sweep must err on the side of keeping files. If any
		// row fails to parse, the reference set is unknowable: abort, delete nothing.
		const referenced = new Set<string>();
		try {
			for (const path of this.imageReferences()) referenced.add(path);
		} catch (e) {
			console.error('[db] abandoned-image sweep skipped because a row failed to parse:', e instanceof Error ? e.message : e);
			return 0;
		}
		let swept = 0;
		for (const name of readdirSync(dir)) {
			const abs = join(dir, name);
			if (!lstatSync(abs).isFile() || !IMAGE_EXT_RE.test(name)) continue;
			const rel = `images/chat/${name}`;
			if (referenced.has(imageReferenceKey(rel))) continue;
			if (statSync(abs).mtimeMs > cutoff) continue;
			try { deleteImage(rel); swept++; }
			catch (error) { console.error('[db] abandoned image could not be removed:', error); }
		}
		const thumbs = join(dir, 'thumbnails');
		if (existsSync(thumbs) && !lstatSync(thumbs).isSymbolicLink()) {
			const owned = new Set(readdirSync(dir).filter(name => IMAGE_EXT_RE.test(name))
				.map(name => imageReferenceKey(thumbnailFor(`images/chat/${name}`).replace(/\.[^.]+$/, ''))));
			for (const path of referenced) owned.add(thumbnailFor(path).replace(/\.[^.]+$/, ''));
			for (const name of readdirSync(thumbs)) {
				const file = join(thumbs, name), rel = `images/chat/thumbnails/${name}`;
				if (!IMAGE_EXT_RE.test(name) || !lstatSync(file).isFile() || statSync(file).mtimeMs > cutoff) continue;
				if (referenced.has(imageReferenceKey(rel)) || owned.has(imageReferenceKey(rel.replace(/\.[^.]+$/, '')))) continue;
				try { deleteImage(rel); swept++; }
				catch (error) { console.error('[db] abandoned thumbnail could not be removed:', error); }
			}
		}
		if (swept > 0) console.log(`[db] swept ${swept} abandoned chat image${swept === 1 ? '' : 's'}`);
		return swept;
	}

	deleteChat(chatId: string): void {
		const paths = this.imagePathsOfChat(chatId);
		this.execute('DELETE FROM chats WHERE id = ?', [chatId]); // messages cascade
		// Steering notes bound to this chat can't cascade, since scope_id has no FK, so they
		// are reaped here, where the delete can't be forgotten.
		// This rides the 'chats' broadcast: another device keeps those note rows cached
		// until its next steering refresh, which is harmless (a chat-scoped note whose
		// chat is gone never resolves): the duplicateChat precedent for one method
		// touching several tables under the one scope that matters.
		this.execute("DELETE FROM steering_notes WHERE scope = 'chat' AND scope_id = ?", [chatId]);
		this.dropOrphanedChatImages(paths);
	}

	// ===== MESSAGES =====

	getMessagesByChat(chatId: string): unknown[] {
		const rows = this.select<Record<string, unknown>[]>('SELECT * FROM messages WHERE chat_id = ?', [chatId]);
		return rows.map((r) => this.mapMessage(r));
	}

	/**
	 * Advance a chat's message revision and return the value this write must carry.
	 *
	 * Every method that writes a messages row calls this (or `revForMessageWrite` when it
	 * only knows the row id) and stamps the rows it touches; every delete records the value
	 * on tombstones. That invariant is the whole delta protocol: miss it in a new writer and
	 * every other device silently keeps the old row until something else changes the chat.
	 * `server/messageRev.test.ts` scans this file for exactly that omission.
	 *
	 * Bumped before the row write, in the same transaction wherever there is one, so a
	 * stored row's rev can never exceed its chat's counter.
	 */
	private bumpMessagesRev(chatId: string): number {
		const row = this.select<{ messages_rev: number }[]>(
			'UPDATE chats SET messages_rev = messages_rev + 1 WHERE id = ? RETURNING messages_rev',
			[chatId]
		)[0];
		if (!row) throw new Error(`bumpMessagesRev: no chat ${chatId}`);
		return row.messages_rev;
	}

	/** `bumpMessagesRev` for writers that only hold a message id. Null when the row is gone,
	 *  which keeps the caller's UPDATE the same silent no-op it always was. */
	private revForMessageWrite(messageId: string): number | null {
		const row = this.select<{ chat_id: string }[]>('SELECT chat_id FROM messages WHERE id = ?', [messageId])[0];
		return row ? this.bumpMessagesRev(row.chat_id) : null;
	}

	private recordMessageTombstones(chatId: string, messageIds: Iterable<string>, rev: number): void {
		for (const id of messageIds) {
			this.execute('INSERT INTO message_tombstones (chat_id, message_id, rev) VALUES (?, ?, ?)', [chatId, id, rev]);
		}
	}

	/**
	 * What changed in a chat after `sinceRev`: the rows to upsert, the ids to drop, and the
	 * rev this answer stands at. `sinceRev` null asks for the whole transcript (a fresh open),
	 * and a `sinceRev` AHEAD of the chat answers full too rather than guessing: the only way
	 * a client gets ahead is a database swapped under it (a restore), and its cache describes
	 * rows this database never held. Null when the chat itself is gone.
	 *
	 * The chat row rides along from the same read: a path is its leaf walked through these
	 * rows, and a leaf read apart from them can name a turn a delete has already taken.
	 */
	getMessagesDelta(chatId: string, sinceRev: number | null): unknown {
		return this.inTransaction(() => {
			const row = this.select<Record<string, unknown>[]>('SELECT * FROM chats WHERE id = ?', [chatId])[0];
			if (!row) return null;
			const chat = this.mapChat(row);
			const rev = row.messages_rev as number;
			if (sinceRev === null || sinceRev > rev) {
				return { rev, chat, full: true, messages: this.getMessagesByChat(chatId) };
			}
			const upserts = this.select<Record<string, unknown>[]>(
				'SELECT * FROM messages WHERE chat_id = ? AND rev > ?',
				[chatId, sinceRev]
			).map((r) => this.mapMessage(r));
			const deletedIds = this.select<{ message_id: string }[]>(
				'SELECT message_id FROM message_tombstones WHERE chat_id = ? AND rev > ?',
				[chatId, sinceRev]
			).map((r) => r.message_id);
			return { rev, chat, full: false, upserts, deletedIds };
		});
	}

	/** chatId → total message rows, in one pass. Powers the chat list's
	 *  "sort by message count" without loading any message bodies. */
	getMessageCounts(): Record<string, number> {
		const rows = this.select<{ chat_id: string; count: number }[]>(
			'SELECT chat_id, COUNT(*) AS count FROM messages GROUP BY chat_id'
		);
		const out: Record<string, number> = {};
		for (const r of rows) out[r.chat_id] = r.count;
		return out;
	}

	/** chatId → created_at of the most recent user message, in one pass. Powers the
	 *  library's "Recent" sort with actual talk activity: seeded greetings and
	 *  bookkeeping touches don't count, only messages the user really sent. */
	getLastUserMessageTimes(): Record<string, number> {
		const rows = this.select<{ chat_id: string; last: number }[]>(
			"SELECT chat_id, MAX(created_at) AS last FROM messages WHERE role = 'user' GROUP BY chat_id"
		);
		const out: Record<string, number> = {};
		for (const r of rows) out[r.chat_id] = r.last;
		return out;
	}

	/** chatId → persona_id of the most recent user message that carried one. Lets the
	 *  chat lists show whose persona a chat was last written with, without loading
	 *  any message bodies. Ties on created_at just keep whichever row comes last. */
	getLastPersonaByChat(): Record<string, string> {
		const rows = this.select<{ chat_id: string; persona_id: string }[]>(
			`SELECT m.chat_id, m.persona_id
			 FROM messages m
			 JOIN (
				SELECT chat_id, MAX(created_at) AS mx
				FROM messages
				WHERE role = 'user' AND persona_id IS NOT NULL
				GROUP BY chat_id
			 ) t ON t.chat_id = m.chat_id AND t.mx = m.created_at
			 WHERE m.role = 'user' AND m.persona_id IS NOT NULL`
		);
		const out: Record<string, string> = {};
		for (const r of rows) out[r.chat_id] = r.persona_id;
		return out;
	}

	// ===== CHAT LIST AGGREGATES =====
	//
	// Everything the chats panel needs to render a row without loading a single
	// message body over the wire. Each method is one pass over the messages table.

	/** Ids along every chat's ACTIVE path (root→active leaf), as one recursive walk up
	 *  the parent chain from each chat's leaf. The basis for the panel's honest counts
	 *  and for restricting search to the branch the reader actually reads. The depth
	 *  bound is a hang guard, not a real limit: the tree can't hold a cycle, but a
	 *  chat list that never returns would be a far worse way to find out it did. */
	private activePathRows(): { chat_id: string; id: string }[] {
		return this.select<{ chat_id: string; id: string }[]>(
			`WITH RECURSIVE path(chat_id, id, parent_id, depth) AS (
				SELECT c.id, m.id, m.parent_id, 0
				FROM chats c JOIN messages m ON m.id = c.active_leaf_id
				UNION ALL
				SELECT p.chat_id, m.id, m.parent_id, p.depth + 1
				FROM messages m JOIN path p ON m.id = p.parent_id
				WHERE p.depth < 100000
			)
			SELECT chat_id, id FROM path`
		);
	}

	/** Per-chat row data for the chats panel: how many turns the active branch holds
	 *  (`path`: what a reader would actually read), how many rows the whole tree holds
	 *  (`total`: every swipe, alternate greeting and abandoned fork), and when that
	 *  branch was last written to (`lastAt`). Lists and previews display `path`;
	 *  deletion uses `total` because it also removes alternate turns.
	 *  No message text: the rows show times and counts, and the only snippet
	 *  the panel renders is the one searchChatMessages cuts around a hit. */
	getChatListStats(): Record<string, { path: number; total: number; lastAt: number | null }> {
		const out: Record<string, { path: number; total: number; lastAt: number | null }> = {};
		const blank = () => ({ path: 0, total: 0, lastAt: null as number | null });

		for (const r of this.select<{ chat_id: string; count: number }[]>(
			'SELECT chat_id, COUNT(*) AS count FROM messages GROUP BY chat_id'
		)) {
			out[r.chat_id] = { ...blank(), total: r.count };
		}

		const pathIds = new Map<string, string[]>();
		for (const r of this.activePathRows()) {
			const bucket = pathIds.get(r.chat_id);
			if (bucket) bucket.push(r.id);
			else pathIds.set(r.chat_id, [r.id]);
		}
		// The active leaf IS the newest turn on the branch, so its timestamp is the
		// branch's: no second MAX() pass, and it can never report a turn that lives on
		// some other branch (which a plain MAX(created_at) over the chat would).
		const leaves = this.select<{ chat_id: string; created_at: number }[]>(
			`SELECT c.id AS chat_id, m.created_at
			 FROM chats c JOIN messages m ON m.id = c.active_leaf_id`
		);
		const leafByChat = new Map(leaves.map((r) => [r.chat_id, r.created_at]));

		for (const [chatId, ids] of pathIds) {
			const entry = (out[chatId] ??= blank());
			entry.path = ids.length;
			entry.lastAt = leafByChat.get(chatId) ?? null;
		}
		return out;
	}

	/** chatId → a key shared by every chat whose message tree is byte-identical, so the
	 *  panel can flag copies at a glance (a Duplicate, or the same ST log imported
	 *  twice). Only chats that actually have a twin appear.
	 *
	 *  Two stages so a big library stays cheap: an aggregate signature in SQL narrows
	 *  the field without reading one byte of content, and only chats that COLLIDE on it
	 *  get their content read and hashed. The hash is structural: a node's digest folds
	 *  in its children's digests, ordered by (sibling_index, child digest), so it is
	 *  independent of row ids and of insertion order, which a copy never reproduces.
	 *  Timestamps are deliberately out of it: same story, same text = same chat. */
	getChatContentGroups(): Record<string, string> {
		const signatures = this.select<{ chat_id: string; n: number; len: number }[]>(
			'SELECT chat_id, COUNT(*) AS n, SUM(LENGTH(content)) AS len FROM messages GROUP BY chat_id HAVING COUNT(*) > 0'
		);
		const bySignature = new Map<string, string[]>();
		for (const s of signatures) {
			const key = `${s.n}:${s.len}`;
			const bucket = bySignature.get(key);
			if (bucket) bucket.push(s.chat_id);
			else bySignature.set(key, [s.chat_id]);
		}

		const out: Record<string, string> = {};
		for (const candidates of bySignature.values()) {
			if (candidates.length < 2) continue;
			const byHash = new Map<string, string[]>();
			for (const chatId of candidates) {
				const hash = this.hashChatTree(chatId);
				const bucket = byHash.get(hash);
				if (bucket) bucket.push(chatId);
				else byHash.set(hash, [chatId]);
			}
			for (const [hash, chatIds] of byHash) {
				if (chatIds.length < 2) continue;
				for (const chatId of chatIds) out[chatId] = hash;
			}
		}
		return out;
	}

	/** Structural digest of one chat's whole message forest (see getChatContentGroups).
	 *  Attachments count as content: two runs of the same words over different pictures
	 *  are not the same chat. `thinking` deliberately does not: reasoning is the model's
	 *  scratch paper, not the story. */
	private hashChatTree(chatId: string): string {
		const rows = this.select<{ id: string; parent_id: string | null; role: string; content: string; attachments_json: string | null; sibling_index: number }[]>(
			'SELECT id, parent_id, role, content, attachments_json, sibling_index FROM messages WHERE chat_id = ?',
			[chatId]
		);
		const children = new Map<string | null, typeof rows>();
		for (const row of rows) {
			const bucket = children.get(row.parent_id);
			if (bucket) bucket.push(row);
			else children.set(row.parent_id, [row]);
		}
		// Iterative post-order: a deep chat must not blow the stack.
		const digest = new Map<string, string>();
		const stack: { row: (typeof rows)[number]; expanded: boolean }[] = (children.get(null) ?? []).map((row) => ({ row, expanded: false }));
		while (stack.length) {
			const frame = stack.pop()!;
			const kids = children.get(frame.row.id) ?? [];
			if (!frame.expanded && kids.length) {
				stack.push({ row: frame.row, expanded: true });
				for (const kid of kids) stack.push({ row: kid, expanded: false });
				continue;
			}
			const kidDigests = kids
				.map((k) => `${k.sibling_index}:${digest.get(k.id) ?? ''}`)
				.sort();
			digest.set(
				frame.row.id,
				shortDigest(
					`${frame.row.role}\u0001${frame.row.content}\u0002${frame.row.attachments_json ?? ''}\u0003${kidDigests.join('\u0004')}`
				)
			);
		}
		const roots = (children.get(null) ?? [])
			.map((r) => `${r.sibling_index}:${digest.get(r.id) ?? ''}`)
			.sort();
		return shortDigest(roots.join('\u0005'));
	}

	/** chatId → { hits, snippet } for chats whose ACTIVE branch contains every term
	 *  (case-insensitive, any order). Off-path branches are deliberately not searched:
	 *  the panel promises "in the story you'd read", and a hit you can't see without a
	 *  branch jump is worse than no hit. `snippet` is a window around the first match
	 *  in the newest matching turn, so the row shows why it matched. */
	searchChatMessages(query: string): Record<string, { hits: number; snippet: string }> {
		const terms = query.trim().split(/\s+/).filter(Boolean).map(foldSearchText);
		if (!terms.length) return {};

		const onPath = new Set<string>();
		for (const r of this.activePathRows()) onPath.add(r.id);
		if (!onPath.size) return {};

		// The narrowest term first: the LIKE that survives the fewest rows does the
		// heavy lifting, and everything after it is a check over what's left.
		const needle = terms.reduce((a, b) => (b.length > a.length ? b : a));
		const folded = foldSearchSql('content');
		const rows = this.select<{ id: string; chat_id: string; content: string; created_at: number }[]>(
			`SELECT id, chat_id, content, created_at FROM messages WHERE ${folded} LIKE ? ESCAPE '\\' ORDER BY created_at ASC`,
			[`%${escapeLike(needle)}%`]
		);

		const out: Record<string, { hits: number; snippet: string }> = {};
		for (const row of rows) {
			if (!onPath.has(row.id)) continue;
			const hay = foldSearchText(row.content);
			if (!terms.every((t) => hay.includes(t))) continue;
			const entry = (out[row.chat_id] ??= { hits: 0, snippet: '' });
			entry.hits += 1;
			// Rows arrive oldest-first, so the last one written wins: the newest hit.
			entry.snippet = snippetAround(row.content, hay.indexOf(terms[0]));
		}
		return out;
	}

	/** What a chat's memory would cost to carry along on a duplicate. Counts only:
	 *  the duplicate dialog asks the user before anything is copied. */
	getChatMemoryFootprint(chatId: string): { enabled: boolean; episodes: number } {
		const state = this.select<{ enabled: number }[]>('SELECT enabled FROM memory_state WHERE chat_id = ?', [chatId])[0];
		const migrated = this.select<{ chat_id: string }[]>('SELECT chat_id FROM memory_scene_migrations WHERE chat_id = ?', [chatId]).length > 0;
		const episodes = this.select<{ n: number }[]>(migrated
			? 'SELECT COUNT(*) AS n FROM memory_scenes WHERE chat_id = ?'
			: 'SELECT COUNT(*) AS n FROM memory_episodes WHERE chat_id = ?', [chatId])[0]?.n ?? 0;
		return { enabled: !!state?.enabled, episodes };
	}

	getMessage(id: string): unknown {
		const rows = this.select<Record<string, unknown>[]>('SELECT * FROM messages WHERE id = ?', [id]);
		return rows[0] ? this.mapMessage(rows[0]) : null;
	}

	insertMessage(message: Record<string, unknown>): void {
		this.inTransaction(() => {
			const rev = this.bumpMessagesRev(message.chatId as string);
			// A live row may never sit shadowed by a tombstone: nothing in the app reuses a
			// message id today, but if one ever comes back, a lingering tombstone would tell
			// every delta reader to delete a row that exists. The row wins.
			this.execute('DELETE FROM message_tombstones WHERE chat_id = ? AND message_id = ?', [
				message.chatId,
				message.id
			]);
			this.execute(
				`INSERT INTO messages
				 (id, chat_id, parent_id, role, content, persona_id, branch_label, thinking, attachments_json, created_at, edited_at, minor_edited_at, sprite_label,
				  model, provider, tokens_prompt, tokens_completion, finish_reason, generation_ms, first_token_ms, reasoning_ms, lore_json, sibling_index, rev, excluded_from_prompt, is_bookmarked)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					message.id,
					message.chatId,
					message.parentId,
					message.role,
					message.content,
					message.personaId ?? null,
					message.branchLabel ? JSON.stringify(message.branchLabel) : null,
					message.thinking ?? null,
					Array.isArray(message.attachments) && message.attachments.length
						? JSON.stringify(message.attachments)
						: null,
					message.createdAt,
					message.editedAt ?? null,
					message.minorEditedAt ?? null,
					message.spriteLabel ?? null,
					message.model ?? null,
					message.provider ?? null,
					message.tokensPrompt ?? null,
					message.tokensCompletion ?? null,
					message.finishReason ?? null,
					message.generationMs ?? null,
					message.firstTokenMs ?? null,
					message.reasoningMs ?? null,
					message.lorebook ? JSON.stringify(message.lorebook) : null,
					message.siblingIndex ?? 0,
					rev,
					message.excludedFromPrompt === true ? 1 : 0,
					message.isBookmarked === true ? 1 : 0
				]
			);
		});
	}

	setMessageExcludedFromPrompt(messageId: string, excluded: boolean, sinceRev: number | null = null): unknown {
		if (typeof excluded !== 'boolean') throw new Error('Expected a boolean prompt exclusion flag.');
		return this.inTransaction(() => {
			const message = this.select<{ chat_id: string }[]>('SELECT chat_id FROM messages WHERE id = ?', [messageId])[0];
			if (!message) throw new Error('The message no longer exists.');
			const rev = this.bumpMessagesRev(message.chat_id);
			this.execute('UPDATE messages SET excluded_from_prompt = ?, rev = ? WHERE id = ?', [
				excluded ? 1 : 0, rev, messageId
			]);
			return this.getMessagesDelta(message.chat_id, sinceRev);
		});
	}


	/** Personal navigation metadata: does not edit the text, memory stamps or chat activity. */
	setMessageBookmarked(messageId: string, bookmarked: boolean, sinceRev: number | null = null): unknown {
		if (typeof bookmarked !== 'boolean') throw new Error('Expected a boolean bookmark flag.');
		return this.inTransaction(() => {
			const message = this.select<{ chat_id: string; is_bookmarked: number }[]>('SELECT chat_id, is_bookmarked FROM messages WHERE id = ?', [messageId])[0];
			if (!message) throw new Error('The message no longer exists.');
			if ((message.is_bookmarked === 1) !== bookmarked) {
				const rev = this.bumpMessagesRev(message.chat_id);
				this.execute('UPDATE messages SET is_bookmarked = ?, rev = ? WHERE id = ?', [bookmarked ? 1 : 0, rev, messageId]);
			}
			return this.getMessagesDelta(message.chat_id, sinceRev);
		});
	}

	/**
	 * Rewrite one turn's text.
	 *
	 * `edited_at` is the systemic staleness signal chat memory compares against, so advancing
	 * it discards the summary covering this turn and buys a paid re-read (architecture/memory.md).
	 * A **minor** edit is the user saying that is not worth doing (the turn still says the
	 * same thing), so it stamps `minor_edited_at` and leaves `edited_at` exactly where it was.
	 * The transcript still marks the turn as edited from either stamp; the summary survives.
	 *
	 * The mode is the caller's assertion, never inferred: no diff of two strings can tell a
	 * typo from a retcon, and guessing wrong in the quiet direction leaves memory describing
	 * a scene that no longer happened.
	 */
	updateMessageContent(messageId: string, content: string, opts?: { minor?: boolean }): void {
		const column = opts?.minor ? 'minor_edited_at' : 'edited_at';
		this.inTransaction(() => {
			const rev = this.revForMessageWrite(messageId);
			this.execute(`UPDATE messages SET content = ?, ${column} = ?, rev = ? WHERE id = ?`, [
				content,
				Date.now(),
				rev,
				messageId
			]);
		});
	}

	/** Extend an assistant turn with a generated continuation: the full joined content plus
	 *  the run's accumulated stats. Deliberately leaves edited_at alone: a continuation is
	 *  more generation, not a user edit, so the turn never gets flagged as edited. The
	 *  legacy sprite metadata is also retained on rewrites:
	 *  whether a rewritten turn is re-read is the caller's decision, gated on a setting the
	 *  server has no business reading (architecture/engines.md).
	 *
	 *  `first_token_ms` is deliberately absent from the patch, so no continuation can touch it:
	 *  it records WHEN this turn started speaking, which happened once, on the run that created
	 *  it. `reasoning_ms` is in the patch because it records HOW MUCH thinking the turn cost,
	 *  and a continuation adds to that the same way it adds to `generation_ms`; the caller
	 *  accumulates both. */
	applyMessageContinuation(
		messageId: string,
		patch: {
			content: string;
			thinking: string | null;
			tokensPrompt: number | null;
			tokensCompletion: number | null;
			finishReason: string | null;
			generationMs: number | null;
			reasoningMs: number | null;
		}
	): void {
		this.inTransaction(() => {
			const rev = this.revForMessageWrite(messageId);
			this.execute(
				'UPDATE messages SET content = ?, thinking = ?, tokens_prompt = ?, tokens_completion = ?, finish_reason = ?, generation_ms = ?, reasoning_ms = ?, rev = ? WHERE id = ?',
				[
					patch.content,
					patch.thinking,
					patch.tokensPrompt,
					patch.tokensCompletion,
					patch.finishReason,
					patch.generationMs,
					patch.reasoningMs,
					rev,
					messageId
				]
			);
			const owner = this.select<{ chat_id: string }[]>('SELECT chat_id FROM messages WHERE id = ?', [messageId])[0];
			if (owner) this.pruneOldReasoning(owner.chat_id);
		});
	}

	/** Re-attribute a message to a persona (or clear it with null). Independent of
	 *  content edits, so it never bumps edited_at. The persona a message was sent with
	 *  is normally locked at send time; this is the deliberate, after-the-fact rebind. */
	updateMessagePersona(messageId: string, personaId: string | null): void {
		this.inTransaction(() => {
			const rev = this.revForMessageWrite(messageId);
			this.execute('UPDATE messages SET persona_id = ?, rev = ? WHERE id = ?', [personaId ?? null, rev, messageId]);
		});
	}

	/** Bind every user turn in a chat to a persona at once (or clear with null). Powers the
	 *  composer's "set persona for this chat" action: imported/legacy chats whose user
	 *  messages have no persona show a plain "You" until re-attributed. Only user rows are
	 *  touched; content and edited_at are left alone. */
	setChatUserPersona(chatId: string, personaId: string | null): void {
		this.inTransaction(() => {
			const rev = this.bumpMessagesRev(chatId);
			this.execute("UPDATE messages SET persona_id = ?, rev = ? WHERE chat_id = ? AND role = 'user'", [
				personaId ?? null,
				rev,
				chatId
			]);
		});
	}

	/**
	 * Splice one row out: its children re-parent to its parent, everything below survives.
	 *
	 * Refused when the row **heads a branch and holds replies**. The splice merges its children
	 * into its parent's child set, and at a fork those two sets answer different turns: the
	 * branches beside it answer what it answers, its own children answer IT. Merged, they leave
	 * a swipe position alternating between a user turn and a reply, which no reader and no
	 * renderer can make sense of. The rule lives here rather than in the delete menus so every
	 * caller inherits it: the client store over RPC, the assistant's `delete_entity`, and
	 * anything added later. Callers that mean it delete the whole subtree instead.
	 */
	/**
	 * A chat's three tree pointers may never name a row that is gone. The transcript is drawn
	 * by walking root→`active_leaf_id`, and that walk stops dead at a missing id: a chat whose
	 * leaf points at a deleted turn renders EMPTY with every one of its messages still in the
	 * table. So every delete path here repairs the pointers in its own transaction rather than
	 * leaving it to whoever called. The client store, the assistant's `delete_entity`, and
	 * anything added later all inherit it, which is the same reason the splice refusal lives
	 * here (architecture/chat-sessions.md coupling 3).
	 *
	 * `doomed` is always a connected subtree, so the nearest surviving ancestor of any pointer
	 * inside it is one value: `escapeId`, the parent of the subtree's head.
	 *
	 * This is the floor, not the policy. A caller with a better answer (the transcript re-homes
	 * the view to a same-role sibling for continuity) simply sets the leaf again afterwards.
	 */
	private repairChatPointers(chatId: string, doomed: Set<string>, escapeId: string | null): void {
		const chat = this.select<{ root_message_id: string | null; active_leaf_id: string | null; canon_leaf_id: string | null }[]>(
			'SELECT root_message_id, active_leaf_id, canon_leaf_id FROM chats WHERE id = ?',
			[chatId]
		)[0];
		if (!chat) return;
		// The first surviving parentless row: what the chat re-roots on, and where the view
		// lands when the doomed subtree reached all the way up and there is no ancestor left.
		const survivingRoot = (): string | null =>
			this.select<{ id: string }[]>(
				'SELECT id FROM messages WHERE chat_id = ? AND parent_id IS NULL ORDER BY sibling_index ASC, created_at ASC LIMIT 1',
				[chatId]
			)[0]?.id ?? null;

		if (chat.active_leaf_id && doomed.has(chat.active_leaf_id)) {
			// Null only when the chat has no messages left at all: a chat that still holds
			// turns must always name one, or the transcript is blank for a different reason.
			this.execute('UPDATE chats SET active_leaf_id = ? WHERE id = ?', [escapeId ?? survivingRoot(), chatId]);
		}
		// The canon marker may legitimately end up unset: with the whole canonical prefix gone
		// there is no spine to draw, and picking an unrelated branch would invent one.
		if (chat.canon_leaf_id && doomed.has(chat.canon_leaf_id)) {
			this.execute('UPDATE chats SET canon_leaf_id = ? WHERE id = ?', [escapeId, chatId]);
		}
		if (chat.root_message_id && doomed.has(chat.root_message_id)) {
			this.execute('UPDATE chats SET root_message_id = ? WHERE id = ?', [survivingRoot(), chatId]);
		}
	}

	deleteMessageOnly(messageId: string): void {
		const message = this.getMessage(messageId) as { chatId: string; parentId: string | null } | null;
		if (!message) return;

		const childCount =
			this.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM messages WHERE parent_id = ?', [messageId])[0]?.n ?? 0;
		if (childCount > 0) {
			// `IS` rather than `=` so a root's NULL parent actually compares, and chat_id so the
			// other chats' roots aren't counted as this one's siblings.
			const branchCount =
				this.select<{ n: number }[]>(
					'SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND parent_id IS ? AND id != ?',
					[message.chatId, message.parentId, messageId]
				)[0]?.n ?? 0;
			if (branchCount > 0) {
				throw new Error(
					`deleteMessageOnly refused: message ${messageId} heads a branch (${branchCount} other branch${branchCount === 1 ? '' : 'es'} beside it) and has ${childCount} ${childCount === 1 ? 'reply' : 'replies'} below it. Splicing it would merge those replies into the fork, leaving a swipe that alternates roles. Delete the whole subtree instead.`
				);
			}
		}

		const paths = this.imagePathsOfMessages([messageId]);
		const tx = this.db.transaction(() => {
			const rev = this.bumpMessagesRev(message.chatId);
			// Re-parented children join the new parent's existing children with fresh sibling
			// indexes appended after them: two merging sibling sets must never share an index.
			const base = this.getNextSiblingIndex(message.chatId, message.parentId);
			const children = this.select<{ id: string }[]>(
				'SELECT id FROM messages WHERE parent_id = ? ORDER BY sibling_index ASC, created_at ASC',
				[messageId]
			);
			children.forEach((child, i) => {
				this.execute('UPDATE messages SET parent_id = ?, sibling_index = ?, rev = ? WHERE id = ?', [
					message.parentId,
					base + i,
					rev,
					child.id
				]);
			});
			this.recordMessageTombstones(message.chatId, [messageId], rev);
			this.execute('DELETE FROM messages WHERE id = ?', [messageId]);
			// The splice re-parents the children, so the one row that vanishes from the tree is
			// this one and the parent is where anything pointing at it lands.
			this.repairChatPointers(message.chatId, new Set([messageId]), message.parentId);
		});
		tx();
		this.dropOrphanedChatImages(paths);
	}

	deleteMessageAndDescendants(messageId: string): void {
		const message = this.getMessage(messageId) as { chatId: string; parentId: string | null } | null;
		if (!message) return;
		const doomed = this.descendantIds(messageId, true);
		const paths = this.imagePathsOfMessages(doomed);
		const tx = this.db.transaction(() => {
			this.recordMessageTombstones(message.chatId, doomed, this.bumpMessagesRev(message.chatId));
			this.execute(
				`WITH RECURSIVE descendants AS (
					SELECT id FROM messages WHERE id = ?
					UNION ALL
					SELECT m.id FROM messages m
					INNER JOIN descendants d ON m.parent_id = d.id
				)
				DELETE FROM messages WHERE id IN (SELECT id FROM descendants)`,
				[messageId]
			);
			this.repairChatPointers(message.chatId, new Set(doomed), message.parentId);
		});
		tx();
		this.dropOrphanedChatImages(paths);
	}

	deleteDescendants(messageId: string): void {
		const message = this.getMessage(messageId) as { chatId: string } | null;
		if (!message) return;
		const doomed = this.descendantIds(messageId, false);
		const paths = this.imagePathsOfMessages(doomed);
		const tx = this.db.transaction(() => {
			this.recordMessageTombstones(message.chatId, doomed, this.bumpMessagesRev(message.chatId));
			this.execute(
				`WITH RECURSIVE descendants AS (
					SELECT id FROM messages WHERE parent_id = ?
					UNION ALL
					SELECT m.id FROM messages m
					INNER JOIN descendants d ON m.parent_id = d.id
				)
				DELETE FROM messages WHERE id IN (SELECT id FROM descendants)`,
				[messageId]
			);
			// Nothing below survives, so the turn itself is where a pointer lands.
			this.repairChatPointers(message.chatId, new Set(doomed), messageId);
		});
		tx();
		this.dropOrphanedChatImages(paths);
	}

	/** The index a new child of `parentId` takes in `chatId`: one past the highest already in
	 *  that sibling set, so it can never land on one that is still there.
	 *
	 *  `IS` rather than `=` so a root's NULL parent actually compares, and `chat_id` because
	 *  every chat's roots carry the same NULL: without it a new chat's first root would be
	 *  numbered off the highest root anywhere in the database. */
	getNextSiblingIndex(chatId: string, parentId: string | null): number {
		const result = this.select<{ max_index: number | null }[]>(
			'SELECT MAX(sibling_index) as max_index FROM messages WHERE chat_id = ? AND parent_id IS ?',
			[chatId, parentId]
		);
		const maxIndex = result[0]?.max_index;
		return maxIndex !== null && maxIndex !== undefined ? maxIndex + 1 : 0;
	}

	// ===== SETTINGS =====

	getAllSettings(): Record<string, string> {
		const rows = this.select<{ key: string; value: string }[]>('SELECT key, value FROM settings');
		return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
	}

	getSetting(key: string): string | null {
		const rows = this.select<{ value: string }[]>('SELECT value FROM settings WHERE key = ?', [key]);
		return rows[0]?.value ?? null;
	}

	setSetting(key: string, value: string): void {
		if (key !== 'generalSettings') {
			this.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
			return;
		}
		this.inTransaction(() => {
			const before = parseReasoningRetention(this.getSetting(key));
			const after = parseReasoningRetention(value);
			this.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
			if (after.autoClearReasoning && JSON.stringify(before) !== JSON.stringify(after)) {
				const chats = this.select<{ chat_id: string }[]>('SELECT DISTINCT chat_id FROM messages WHERE thinking IS NOT NULL');
				for (const chat of chats) this.pruneOldReasoning(chat.chat_id, after);
			}
		});
	}

	/** Retention counts message positions, so swipes at one position never age the chat.
	 *  Only the text is discarded: timing/usage and story edits remain historical facts. */
	private pruneOldReasoning(chatId: string, policy = parseReasoningRetention(this.getSetting('generalSettings'))): void {
		if (!policy.autoClearReasoning) return;
		this.inTransaction(() => {
			const changed = this.execute(`WITH RECURSIVE positions(id, depth) AS (
				SELECT id, 0 FROM messages WHERE chat_id = ? AND parent_id IS NULL
				UNION ALL
				SELECT m.id, p.depth + 1 FROM messages m JOIN positions p ON m.parent_id = p.id WHERE m.chat_id = ?
			)
			UPDATE messages SET thinking = NULL, rev = (SELECT messages_rev + 1 FROM chats WHERE id = ?)
			WHERE chat_id = ? AND thinking IS NOT NULL AND id IN (
				SELECT id FROM positions WHERE depth <= (
					SELECT depth FROM positions WHERE id = (SELECT active_leaf_id FROM chats WHERE id = ?)
				) - ?
			)`, [chatId, chatId, chatId, chatId, chatId, policy.reasoningDepth]);
			if (changed) this.bumpMessagesRev(chatId);
		});
	}

	deleteSetting(key: string): void {
		this.execute('DELETE FROM settings WHERE key = ?', [key]);
	}

	// ===== CHAT DRAFTS =====

	getChatDraft(chatId: string): unknown {
		const rows = this.select<{ chat_id: string; content: string; updated_at: number }[]>(
			'SELECT * FROM chat_drafts WHERE chat_id = ?',
			[chatId]
		);
		if (!rows[0]) return null;
		return { chatId: rows[0].chat_id, content: rows[0].content, updatedAt: rows[0].updated_at };
	}

	upsertChatDraft(chatId: string, content: string): void {
		this.execute(
			`INSERT INTO chat_drafts (chat_id, content, updated_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(chat_id) DO UPDATE SET
			 content = excluded.content,
			 updated_at = excluded.updated_at`,
			[chatId, content, Date.now()]
		);
	}

	deleteChatDraft(chatId: string): void {
		this.execute('DELETE FROM chat_drafts WHERE chat_id = ?', [chatId]);
	}

	// ===== INPUT HISTORY =====

	/** The newest `limit` entries, oldest → newest (nav walks it back to front). */
	getInputHistory(limit: number): unknown[] {
		const rows = this.select<{ id: number; chat_id: string | null; content: string }[]>(
			'SELECT * FROM (SELECT id, chat_id, content FROM input_history ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
			[this.clampHistoryCap(limit)]
		);
		return rows.map((r) => ({ id: r.id, chatId: r.chat_id, content: r.content }));
	}

	/** Append one sent message and trim the log to the cap in the same transaction. */
	addInputHistory(chatId: string | null, content: string, cap: number): void {
		const limit = this.clampHistoryCap(cap);
		const tx = this.db.transaction(() => {
			this.execute('INSERT INTO input_history (chat_id, content, created_at) VALUES (?, ?, ?)', [
				chatId,
				content,
				Date.now()
			]);
			this.execute(
				'DELETE FROM input_history WHERE id NOT IN (SELECT id FROM input_history ORDER BY id DESC LIMIT ?)',
				[limit]
			);
		});
		tx();
	}

	clearInputHistory(): void {
		this.execute('DELETE FROM input_history');
	}

	private clampHistoryCap(cap: number): number {
		return Number.isFinite(cap) ? Math.min(1000, Math.max(10, Math.round(cap))) : 100;
	}

	// ===== CONNECTION CREDENTIALS =====

	getConnectionCredentials(connectionId: string): unknown {
		const rows = this.select<{ provider: string; api_key_encrypted: string; base_url: string | null }[]>(
			'SELECT provider, api_key_encrypted, base_url FROM connection_credentials WHERE connection_id = ?',
			[connectionId]
		);
		if (!rows[0]) return null;
		return { provider: rows[0].provider, apiKey: rows[0].api_key_encrypted, baseUrl: rows[0].base_url };
	}

	setConnectionCredentials(connectionId: string, provider: string, apiKey: string, baseUrl?: string): void {
		this.execute(
			`INSERT OR REPLACE INTO connection_credentials (connection_id, provider, api_key_encrypted, base_url, updated_at)
			 VALUES (?, ?, ?, ?, ?)`,
			[connectionId, provider, apiKey, baseUrl ?? null, Date.now()]
		);
	}

	deleteConnectionCredentials(connectionId: string): void {
		this.execute('DELETE FROM connection_credentials WHERE connection_id = ?', [connectionId]);
	}

	/** Duplicate one connection's stored credentials under another connection id,
	 *  entirely server-side, so the key never rides the wire. No-op when the source
	 *  has no credentials. */
	copyConnectionCredentials(fromConnectionId: string, toConnectionId: string): void {
		this.execute(
			`INSERT OR REPLACE INTO connection_credentials (connection_id, provider, api_key_encrypted, base_url, updated_at)
			 SELECT ?, provider, api_key_encrypted, base_url, ? FROM connection_credentials WHERE connection_id = ?`,
			[toConnectionId, Date.now(), fromConnectionId]
		);
	}

	// ===== CHARACTER LIBRARY =====

	getAllLibraryEntries(): unknown[] {
		const rows = this.select<{ id: string; type: string; data_json: string; is_favorite: number; created_at: number; updated_at: number }[]>(
			'SELECT * FROM character_library ORDER BY updated_at DESC'
		);
		return rows.map((row) => this.mapLibraryEntry(row));
	}

	getLibraryEntry(id: string): unknown {
		const rows = this.select<{ id: string; type: string; data_json: string; is_favorite: number; created_at: number; updated_at: number }[]>(
			'SELECT * FROM character_library WHERE id = ?',
			[id]
		);
		return rows[0] ? this.mapLibraryEntry(rows[0]) : null;
	}

	/** The stored payload: identity + data, plus the pointers that live BESIDE the data (the
	 *  active version, and what a new chat with this character starts on). Each is written
	 *  only when set, so an entry carrying none of them stores byte for byte what it stored
	 *  before any of them existed, which is what spares every one a migration. */
	private libraryPayload(entry: Record<string, unknown>): Record<string, unknown> {
		const payload: Record<string, unknown> = { identity: entry.identity, data: entry.data };
		if (entry.activeVersionId) payload.activeVersionId = entry.activeVersionId;
		for (const key of CHAT_DEFAULT_KEYS) {
			if (entry[key]) payload[key] = entry[key];
		}
		if (entry.type === 'character' && entry.characterAuthorsNote !== undefined) {
			payload.characterAuthorsNote = normalizeCharacterAuthorsNote(entry.characterAuthorsNote);
		}
		return payload;
	}

	insertLibraryEntry(entry: Record<string, unknown>): void {
		this.execute(
			`INSERT INTO character_library (id, type, data_json, is_favorite, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[entry.id, entry.type, JSON.stringify(this.libraryPayload(entry)), entry.isFavorite ? 1 : 0, entry.createdAt, entry.updatedAt]
		);
	}

	/** Save an entry and carry a changed opening into the chats that are still nothing but
	 *  that opening (refreshSeededGreetings). Returns the ids of the chats whose rows moved,
	 *  so the caller can announce the `messages` scope beside `library`. Every door writes
	 *  through here, so none of them has to reimplement the rule. */
	updateLibraryEntry(entry: Record<string, unknown>): string[] {
		return this.inTransaction(() => {
			// Read before the overwrite: the greetings this save is REPLACING are what tells a
			// chat that only mirrors the card from one that holds a story.
			const stored = this.select<{ type: string; data_json: string }[]>(
				'SELECT type, data_json FROM character_library WHERE id = ?',
				[entry.id]
			)[0];
			const payload = this.libraryPayload(entry);
			// Card editors can hold old snapshots. Only the dedicated private-note
			// mutation may change this field; a normal card/version save preserves it.
			const privateNote = stored?.type === 'character'
				? (JSON.parse(stored.data_json) as Record<string, unknown>).characterAuthorsNote : undefined;
			if (privateNote !== undefined) payload.characterAuthorsNote = normalizeCharacterAuthorsNote(privateNote);
			else delete payload.characterAuthorsNote;
			this.execute('UPDATE character_library SET data_json = ?, updated_at = ? WHERE id = ?', [
				JSON.stringify(payload),
				Date.now(),
				entry.id
			]);
			// The entry's data IS the active variant's content; mirror every save into that
			// variant's row so parked/active rows are uniformly readable (pinned chats,
			// export, import) without a "which one is live" special case anywhere else.
			if (entry.activeVersionId) {
				this.execute(
					'UPDATE character_versions SET data_json = ?, updated_at = ? WHERE id = ? AND entry_id = ?',
					[JSON.stringify(entry.data), Date.now(), entry.activeVersionId, entry.id]
				);
			}
			return stored ? this.refreshSeededGreetings(entry, stored) : [];
		});
	}

	/** Patch only private character state, without rewriting traits or active version data. */
	updateCharacterAuthorsNote(id: string, raw: unknown): CharacterAuthorsNote {
		return this.inTransaction(() => {
			const stored = this.select<{ type: string; data_json: string }[]>(
				'SELECT type, data_json FROM character_library WHERE id = ?', [id]
			)[0];
			if (!stored || stored.type !== 'character') throw new Error('That character no longer exists.');
			const note = normalizeCharacterAuthorsNote(raw);
			const payload = JSON.parse(stored.data_json) as Record<string, unknown>;
			payload.characterAuthorsNote = note;
			this.execute('UPDATE character_library SET data_json = ?, updated_at = ? WHERE id = ?',
				[JSON.stringify(payload), Date.now(), id]);
			return note;
		});
	}

	/**
	 * Carry a character's changed opening into the chats that are still nothing but that
	 * opening.
	 *
	 * A chat nobody has written in is a **mirror** of the card, not a copy of it: its rows
	 * hold the First Message and the alternate greetings and nothing else, so an edit to the
	 * card has to reach them or every unstarted chat quietly opens on a version of the
	 * character that no longer exists. The moment the chat holds something the user put
	 * there (a turn, a reply, a hand-edited greeting, an extra opening written by hand), it
	 * is a story, and the card stops reaching it.
	 *
	 * There is deliberately **no "this chat has been used" flag**. A chat qualifies by what it
	 * holds right now: exactly the greetings the card handed it (`chats.seeded_greetings`),
	 * every row still an unedited root-level assistant turn. That is what makes
	 * the rewrite safe (a single character the user typed anywhere in the chat breaks the
	 * match), and it is why a chat emptied back down to its greetings follows the card again:
	 * nothing left in it is the user's to protect, and "has this been used" is a question about
	 * the past rather than about what the chat holds.
	 *
	 * **Recognition asks the CHAT, never the card's history**, and that is the load-bearing
	 * half. Matching against the greetings a save happens to be replacing looks equivalent and
	 * is not: a chat holding a story while the card moves on ends up holding a text the card no
	 * longer recognises, so emptying it back out could never hand it back. What that produced
	 * is worse than either answer: the chat followed the card or not depending on invisible
	 * history, which from outside reads as random.
	 *
	 * Scope is the variant that actually changed. Chats pinned elsewhere keep what they were
	 * pinned to, and a save that MOVES the active pointer (a fork, a version switch) is not a
	 * content edit at all, so it reconciles nothing.
	 */
	private refreshSeededGreetings(entry: Record<string, unknown>, stored: { type: string; data_json: string }): string[] {
		if (stored.type !== 'character') return [];
		const previous = JSON.parse(stored.data_json) as { data?: unknown; activeVersionId?: string };
		const versionId = (entry.activeVersionId as string | undefined) ?? null;
		if ((previous.activeVersionId ?? null) !== versionId) return [];

		// The card's own before/after decides only whether there is anything to do at all:
		// every other save of the entry (a tag, a description, an autosave tick while the user
		// types in some other field) stops here without looking at a single chat.
		const before = chatGreetingsOf(previous.data);
		const after = chatGreetingsOf(entry.data);
		if (before.length === after.length && before.every((greeting, i) => greeting === after[i])) return [];

		// One query names the candidates, and it COUNTS each chat's messages rather than reading
		// them: a chat whose row count already disagrees with its own claim cannot be a mirror,
		// and pulling a long story's turns to find that out would put whole chats on the wire
		// every time the user pauses typing in the First Message field.
		// `IS ?` rather than `= ?`: an unversioned character's chats carry a NULL pin, and
		// `= NULL` matches no row at all.
		const chats = this.select<{ id: string; active_leaf_id: string | null; canon_leaf_id: string | null; seeded_greetings: string; row_count: number }[]>(
			`SELECT c.id, c.active_leaf_id, c.canon_leaf_id, c.seeded_greetings,
			        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS row_count
			 FROM chats c
			 WHERE c.character_id = ? AND c.character_version_id IS ? AND c.seeded_greetings IS NOT NULL`,
			[entry.id, versionId]
		);

		const touched: string[] = [];
		for (const chat of chats) {
			const claimed = JSON.parse(chat.seeded_greetings) as string[];
			if (chat.row_count !== claimed.length) continue;
			const rows = this.select<Record<string, unknown>[]>(
				'SELECT * FROM messages WHERE chat_id = ? ORDER BY sibling_index',
				[chat.id]
			);
			if (!this.mirrorsGreetings(rows, claimed)) continue;
			this.rewriteSeededGreetings(chat, rows, after);
			this.setChatSeededGreetings(chat.id, after);
			touched.push(chat.id);
		}
		return touched;
	}

	/** Record what the card handed this chat, at the moment it hands it over. Written by every
	 *  seeding path (the client store's `seedCharacterGreetings`, the assistant's `create_chat`,
	 *  and the refresh above) and read only by the refresh: the client never reads it back,
	 *  which is why `mapChat` deliberately does not carry it. */
	setChatSeededGreetings(chatId: string, greetings: string[]): void {
		this.execute('UPDATE chats SET seeded_greetings = ? WHERE id = ?', [JSON.stringify(greetings), chatId]);
	}

	/** Is this chat still nothing but the greetings it claims, untouched? Anything else in it
	 *  (a turn, a reply hanging under a greeting, an edit stamp, an attachment, an opening the
	 *  user wrote by hand) means it is a story the card may not rewrite. */
	private mirrorsGreetings(rows: Record<string, unknown>[], greetings: string[]): boolean {
		if (rows.length !== greetings.length) return false;
		return rows.every(
			(row, i) =>
				row.parent_id === null &&
				row.role === 'assistant' &&
				row.edited_at === null &&
				row.minor_edited_at === null &&
				row.attachments_json === null &&
				row.sibling_index === i &&
				row.content === greetings[i]
		);
	}

	/** Move a mirroring chat onto the card's current greetings, in place. */
	private rewriteSeededGreetings(
		chat: { id: string; active_leaf_id: string | null; canon_leaf_id: string | null },
		rows: Record<string, unknown>[],
		greetings: string[]
	): void {
		const kept = Math.min(rows.length, greetings.length);
		// Bumped once for however many rows this rewrite touches; lazy, so a save that
		// changes nothing advances nothing and other devices are not asked to re-read.
		let rev: number | null = null;
		// Rewritten in place rather than reseeded: the row ids are what the chat's pointers
		// name, so a reader parked on the third greeting is still on the third greeting after.
		// No `edited_at` either: the card wrote this, not the user, and that stamp is the
		// transcript's "edited" mark and memory's staleness signal (architecture/memory.md).
		for (let i = 0; i < kept; i++) {
			if (rows[i].content === greetings[i]) continue;
			rev ??= this.bumpMessagesRev(chat.id);
			this.execute('UPDATE messages SET content = ?, rev = ? WHERE id = ?', [greetings[i], rev, rows[i].id]);
		}

		const dropped = rows.slice(kept);
		if (dropped.length) {
			// A chat pointer naming a row that is gone renders the chat EMPTY with every
			// message still in the table (see repairChatPointers), so the pointers retreat
			// off the rows about to go rather than being repaired afterwards.
			const gone = new Set(dropped.map((row) => row.id as string));
			const pointers: Record<string, unknown> & { id: string } = { id: chat.id };
			if (chat.active_leaf_id && gone.has(chat.active_leaf_id)) pointers.activeLeafId = rows[0].id;
			if (chat.canon_leaf_id && gone.has(chat.canon_leaf_id)) pointers.canonLeafId = null;
			// The card lost its opening entirely: the chat is empty until it has one again.
			if (greetings.length === 0) {
				pointers.rootMessageId = null;
				pointers.activeLeafId = null;
				pointers.canonLeafId = null;
			}
			this.updateChat(pointers);
			rev ??= this.bumpMessagesRev(chat.id);
			this.recordMessageTombstones(chat.id, dropped.map((row) => row.id as string), rev);
			for (const row of dropped) this.execute('DELETE FROM messages WHERE id = ?', [row.id]);
		}

		const now = Date.now();
		let firstAdded: string | null = null;
		for (let i = kept; i < greetings.length; i++) {
			const id = randomUUID();
			this.insertMessage({
				id,
				chatId: chat.id,
				parentId: null,
				role: 'assistant',
				content: greetings[i],
				createdAt: now + i,
				siblingIndex: i
			});
			firstAdded ??= id;
		}
		// A character that had no opening at all just gained one; the chat has to point at it.
		if (rows.length === 0 && firstAdded) {
			this.updateChat({ id: chat.id, rootMessageId: firstAdded, activeLeafId: firstAdded });
		}
	}

	updateLibraryEntryFavorite(id: string, isFavorite: boolean): void {
		this.execute('UPDATE character_library SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, id]);
	}

	/** Delete an entry, holding the persona floor on the way: the library always has at least
	 *  one persona, and the active pointer always names a row that exists. Both halves live
	 *  here rather than in the Library views because this is the one door every delete goes
	 *  through (the client's RPC bridge and the assistant's `delete_entity` alike), and a rule
	 *  the assistant can walk around is not a rule. Returns the persona the active pointer
	 *  moved to, or null when it did not move; the callers announce the `settings` scope off
	 *  that, since a moved pointer is a settings write riding a library one. */
	deleteLibraryEntry(id: string): string | null {
		const row = this.select<{ type: string }[]>(
			'SELECT type FROM character_library WHERE id = ?',
			[id]
		)[0];
		if (row?.type !== 'persona') {
			this.execute('DELETE FROM character_library WHERE id = ?', [id]);
			return null;
		}

		// Ordered like getAllLibraryEntries, so the survivor that takes over is the one at the
		// top of the reader's own list rather than an arbitrary row.
		const survivors = this.select<{ id: string }[]>(
			"SELECT id FROM character_library WHERE type = 'persona' AND id != ? ORDER BY updated_at DESC",
			[id]
		);
		if (survivors.length === 0) {
			throw new Error(
				'The app keeps at least one persona and this is the last one. Create another persona first.'
			);
		}

		return this.inTransaction(() => {
			let movedActiveTo: string | null = null;
			if (this.getSetting('activePersonaId') === id) {
				movedActiveTo = survivors[0].id;
				this.setSetting('activePersonaId', movedActiveTo);
			}
			this.execute('DELETE FROM character_library WHERE id = ?', [id]);
			return movedActiveTo;
		});
	}

	// ===== CHARACTER VERSIONS =====

	private mapCharacterVersion(row: { id: string; entry_id: string; name: string; data_json: string; created_at: number; updated_at: number }): unknown {
		return {
			id: row.id,
			entryId: row.entry_id,
			name: row.name,
			data: JSON.parse(row.data_json),
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}

	getAllCharacterVersions(): unknown[] {
		const rows = this.select<{ id: string; entry_id: string; name: string; data_json: string; created_at: number; updated_at: number }[]>(
			'SELECT * FROM character_versions ORDER BY created_at ASC'
		);
		return rows.map((r) => this.mapCharacterVersion(r));
	}

	getCharacterVersion(id: string): unknown {
		const rows = this.select<{ id: string; entry_id: string; name: string; data_json: string; created_at: number; updated_at: number }[]>(
			'SELECT * FROM character_versions WHERE id = ?',
			[id]
		);
		return rows[0] ? this.mapCharacterVersion(rows[0]) : null;
	}

	/** All variant rows of one entry, oldest first. The entry delete cascades them away. */
	getCharacterVersionsByEntry(entryId: string): unknown[] {
		const rows = this.select<{ id: string; entry_id: string; name: string; data_json: string; created_at: number; updated_at: number }[]>(
			'SELECT * FROM character_versions WHERE entry_id = ? ORDER BY created_at ASC',
			[entryId]
		);
		return rows.map((r) => this.mapCharacterVersion(r));
	}

	insertCharacterVersion(version: { id: string; entryId: string; name: string; data: unknown; createdAt: number; updatedAt: number }): void {
		this.execute(
			`INSERT INTO character_versions (id, entry_id, name, data_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[version.id, version.entryId, version.name, JSON.stringify(version.data), version.createdAt, version.updatedAt]
		);
	}

	renameCharacterVersion(id: string, name: string): void {
		this.execute('UPDATE character_versions SET name = ?, updated_at = ? WHERE id = ?', [name, Date.now(), id]);
	}

	deleteCharacterVersion(id: string): void {
		this.execute('DELETE FROM character_versions WHERE id = ?', [id]);
	}

	/** Pin every not-yet-pinned chat of a character to the given version. Runs once,
	 *  when a character is first versioned: the chats played against the pre-version
	 *  state get anchored to the baseline row so they keep exactly what they saw. */
	pinUnpinnedChatsToVersion(entryId: string, versionId: string): void {
		this.execute(
			'UPDATE chats SET character_version_id = ? WHERE character_id = ? AND character_version_id IS NULL',
			[versionId, entryId]
		);
	}

	private mapLibraryEntry(row: { id: string; type: string; data_json: string; is_favorite: number; created_at: number; updated_at: number }): unknown {
		const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
		return {
			id: row.id,
			type: row.type,
			...parsed,
			isFavorite: row.is_favorite === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}

	// ===== LOREBOOKS =====

	/**
	 * A row whose payload will not parse is reported and left exactly as it is, never guessed
	 * at: it reads as no book rather than taking the shelf, every generation in the install and
	 * its own delete down with it.
	 */
	private mapLorebook(row: { id: string; data_json: string; created_at: number; updated_at: number }): unknown {
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(row.data_json) as Record<string, unknown>;
		} catch (e) {
			console.error(`[db] corrupt lorebook ${row.id}:`, e instanceof Error ? e.message : e);
			return null;
		}
		return { id: row.id, ...parsed, createdAt: row.created_at, updatedAt: row.updated_at };
	}

	getAllLorebooks(): unknown[] {
		const rows = this.select<{ id: string; data_json: string; created_at: number; updated_at: number }[]>(
			'SELECT * FROM lorebooks ORDER BY updated_at DESC'
		);
		return rows.map((r) => this.mapLorebook(r)).filter((b) => b !== null);
	}

	getLorebook(id: string): unknown {
		const rows = this.select<{ id: string; data_json: string; created_at: number; updated_at: number }[]>(
			'SELECT * FROM lorebooks WHERE id = ?',
			[id]
		);
		return rows[0] ? this.mapLorebook(rows[0]) : null;
	}

	/** A cover names a file in the book's OWN folder and nothing else: `deleteLorebook` unlinks
	 *  whatever the row says, so another category's path would sweep a character's portrait. */
	private assertLorebookCover(cover: unknown): void {
		if (cover === undefined || cover === null) return;
		if (typeof cover !== 'string' || !/^images\/lorebooks\/[^/\\]+$/.test(cover)) {
			throw new Error(`Lorebook cover must be images/lorebooks/<file>, got: ${JSON.stringify(cover)}`);
		}
	}

	insertLorebook(book: Record<string, unknown>): void {
		this.assertLorebookCover(book.cover);
		const payload = {
			name: book.name,
			global: book.global,
			cover: book.cover,
			coverFocus: book.coverFocus,
			scanDepth: book.scanDepth,
			recursiveScanning: book.recursiveScanning,
			maxRecursionSteps: book.maxRecursionSteps,
			caseSensitive: book.caseSensitive,
			matchWholeWords: book.matchWholeWords,
			entries: book.entries,
			extensions: book.extensions
		};
		this.execute('INSERT INTO lorebooks (id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?)', [
			book.id,
			JSON.stringify(payload),
			book.createdAt ?? Date.now(),
			book.updatedAt ?? Date.now()
		]);
	}

	updateLorebook(book: Record<string, unknown>): void {
		this.assertLorebookCover(book.cover);
		const payload = {
			name: book.name,
			global: book.global,
			cover: book.cover,
			coverFocus: book.coverFocus,
			scanDepth: book.scanDepth,
			recursiveScanning: book.recursiveScanning,
			maxRecursionSteps: book.maxRecursionSteps,
			caseSensitive: book.caseSensitive,
			matchWholeWords: book.matchWholeWords,
			entries: book.entries,
			extensions: book.extensions
		};
		const changed = this.execute('UPDATE lorebooks SET data_json = ?, updated_at = ? WHERE id = ?', [
			JSON.stringify(payload),
			Date.now(),
			book.id
		]);
		// A book deleted on another device takes no writes, and SQLite says nothing about it.
		// Silence here is an edit that reached nothing, and in a transfer it is the destination
		// write "succeeding" before the source is cut.
		if (changed === 0) throw new Error(`updateLorebook: no lorebook with id ${String(book.id)}`);
	}

	deleteLorebook(id: string): void {
		// The cover is the book's own file (an upload lands on this book alone), so it goes
		// with the row. The sweep lives HERE rather than in each caller because both doors
		// reach this method: the client store over the RPC bridge, and the assistant's
		// delete_entity. Nothing else can reach images/lorebooks/, so one missed here sits
		// on disk forever.
		const cover = (this.getLorebook(id) as { cover?: string } | null)?.cover;
		// Just drop the book. A character/persona may keep this id in data.lorebookIds, but
		// every reader resolves links against existing books (prompt-builder, the store's
		// booksForChat, the assistant, the link picker and both link counts) and skips ids with
		// no book, so a dangling id is inert, and it's dropped the next time that entry's links
		// are edited; an ordinary save carries it, since it sends data whole. We deliberately do NOT
		// rewrite character_library here: that cross-table write under the 'lorebooks' sync
		// scope would leave other devices' library caches stale and resurrect the id on a later
		// save. Read-time filtering is the single, consistent source of truth.
		this.execute('DELETE FROM lorebooks WHERE id = ?', [id]);
		if (cover) {
			try {
				this.deleteUnusedImage(cover);
			} catch (e) {
				// The row is already gone and its delete autocommitted. A file the OS refuses to
				// unlink must not cost the sync hint, the backup stamp or the rest of a selection.
				console.error(`[db] lorebook ${id}: cover ${cover} could not be deleted:`, e instanceof Error ? e.message : e);
			}
		}
	}

	// ===== STEERING NOTES =====

	private mapSteeringNote(row: {
		id: string;
		scope: string;
		scope_id: string | null;
		data_json: string;
		created_at: number;
		updated_at: number;
	}): unknown {
		const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
		return {
			id: row.id,
			scope: row.scope,
			scopeId: row.scope_id,
			...parsed,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}

	/** The payload keys: everything that is NOT its own column. An explicit whitelist,
	 *  like the lorebook writer: a new note field must be named here or it round-trips
	 *  in memory and vanishes the moment the row is rewritten. */
	private steeringNotePayload(note: Record<string, unknown>): string {
		return JSON.stringify({
			title: note.title,
			text: note.text,
			enabled: note.enabled,
			mode: note.mode,
			depth: note.depth,
			role: note.role,
			sortOrder: note.sortOrder,
			transient: note.transient === true ? true : undefined
		});
	}

	getAllSteeringNotes(): unknown[] {
		const rows = this.select<
			{ id: string; scope: string; scope_id: string | null; data_json: string; created_at: number; updated_at: number }[]
		>('SELECT * FROM steering_notes ORDER BY created_at ASC');
		return rows.map((r) => this.mapSteeringNote(r));
	}

	insertSteeringNote(note: Record<string, unknown>): void {
		this.execute(
			'INSERT INTO steering_notes (id, scope, scope_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
			[
				note.id,
				note.scope,
				note.scopeId ?? null,
				this.steeringNotePayload(note),
				note.createdAt ?? Date.now(),
				note.updatedAt ?? Date.now()
			]
		);
	}

	updateSteeringNote(note: Record<string, unknown>): void {
		// Position and quick/saved origin are preserved: stale editors must not rewrite them.
		const current = this.select<{ data_json: string }[]>('SELECT data_json FROM steering_notes WHERE id = ?', [note.id])[0];
		const saved = current ? JSON.parse(current.data_json) as Record<string, unknown> : {};
		const { sortOrder, transient } = saved;
		// Scope is rewritten too: re-binding a note to another character or chat is an
		// ordinary edit, not a delete-and-recreate.
		this.execute('UPDATE steering_notes SET scope = ?, scope_id = ?, data_json = ?, updated_at = ? WHERE id = ?', [
			note.scope,
			note.scopeId ?? null,
			this.steeringNotePayload({ ...note, sortOrder, transient }),
			Date.now(),
			note.id
		]);
	}

	deleteSteeringNote(id: string): void {
		this.execute('DELETE FROM steering_notes WHERE id = ?', [id]);
	}

	/** Quick guidance is discarded; reusable Next reply guidance is disabled and kept.
	 *  Shared by generated-turn commits and client-persisted continuations. */
	consumeSteeringNotes(ids: string[]): string[] {
		if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid steering ids');
		return this.inTransaction(() => {
			const spent: string[] = [];
			for (const id of new Set(ids)) {
				const row = this.select<{ data_json: string }[]>('SELECT data_json FROM steering_notes WHERE id = ?', [id])[0];
				if (!row) continue;
				let note: { mode?: unknown; enabled?: unknown; transient?: unknown };
				try { note = JSON.parse(row.data_json); }
				catch {
					console.error(`[steering] note ${id} will not parse, so it was left armed instead of spent.`);
					continue;
				}
				// A note changed to Every reply, disabled or deleted during generation stays as-is.
				if (note?.mode !== 'once' || note.enabled !== true) continue;
				if (note.transient === true) this.execute('DELETE FROM steering_notes WHERE id = ?', [id]);
				else this.execute("UPDATE steering_notes SET data_json = json_set(data_json, '$.enabled', json('false')), updated_at = ? WHERE id = ?", [Date.now(), id]);
				spent.push(id);
			}
			return spent;
		});
	}

	reorderSteeringNotes(ids: string[]): string[] {
		if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) throw new Error('Invalid steering order');
		return this.inTransaction(() => {
			const current = librarySteeringNotes(this.getAllSteeringNotes() as SteeringNote[]);
			const remaining = new Set(current.map(note => note.id));
			const ordered: string[] = [];
			for (const id of ids) if (remaining.delete(id)) ordered.push(id);
			// Concurrent additions remain present; deleted/duplicate ids cannot recreate rows.
			ordered.push(...current.filter(note => remaining.has(note.id)).map(note => note.id));
			ordered.forEach((id, index) => this.execute(
				"UPDATE steering_notes SET data_json = json_set(data_json, '$.sortOrder', ?), updated_at = ? WHERE id = ?",
				[index, Date.now(), id]
			));
			return ordered;
		});
	}

	private importLegacyScenes(chatId: string): void {
		if (this.select<{ chat_id: string }[]>('SELECT chat_id FROM memory_scene_migrations WHERE chat_id = ?', [chatId]).length) return;
		this.inTransaction(() => {
			if (!this.getChat(chatId)) throw new Error('Chat not found');
			if (this.select<{ chat_id: string }[]>('SELECT chat_id FROM memory_scene_migrations WHERE chat_id = ?', [chatId]).length) return;
			const all = this.getMessagesByChat(chatId) as (SceneMessage & { editedAt?: number | null })[];
			const byId = new Map(all.map((message) => [message.id, message]));
			const enabled = this.select<{ enabled: number }[]>('SELECT enabled FROM memory_state WHERE chat_id = ?', [chatId])[0]?.enabled === 1;
			const episodes = this.select<Record<string, any>[]>('SELECT * FROM memory_episodes WHERE chat_id = ? ORDER BY rowid', [chatId]);
			for (const [index, episode] of episodes.entries()) {
				let ids: string[] = [];
				try { const value = JSON.parse(episode.source_message_ids ?? '[]'); if (Array.isArray(value)) ids = value.filter((id) => typeof id === 'string'); } catch { /* Preserve as reviewable text. */ }
				const wanted = new Set(ids);
				const ordered = scenePath(all, episode.anchor_message_id ?? ids.at(-1) ?? null).filter((m) => wanted.has(m.id));
				const source = captureScene(ordered);
				for (const id of ids) if (!source.some((s) => s.id === id)) source.push({ id, signature: '' });
				const stale = !enabled || !ids.length || ids.length !== ordered.length || ids.some((id) => {
					const message = byId.get(id);
					return !message || message.excludedFromPrompt || (message.editedAt ?? 0) >= episode.created_at;
				});
				this.execute('INSERT INTO memory_scenes (id, chat_id, title, content, source_json, created_at, updated_at, revision, review_reason) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', [
					randomUUID(), chatId, `Imported memory ${index + 1}`, episode.content, JSON.stringify(source), episode.created_at, Date.now(),
					stale ? 'Imported memory needs review before it can replace messages.' : null
				]);
			}
			this.execute('INSERT INTO memory_scene_migrations (chat_id) VALUES (?)', [chatId]);
		});
	}

	getMemoryScenes(chatId: string): MemoryScene[] {
		this.importLegacyScenes(chatId);
		return this.select<Record<string, any>[]>('SELECT * FROM memory_scenes WHERE chat_id = ? ORDER BY created_at, rowid', [chatId]).map((row) => ({
			id: row.id, chatId: row.chat_id, title: row.title, content: row.content,
			source: JSON.parse(row.source_json), createdAt: row.created_at, updatedAt: row.updated_at,
			revision: row.revision, reviewReason: row.review_reason ?? null, level: row.level, children: JSON.parse(row.children_json)
		}));
	}

	saveMemoryScene(input: SaveMemoryScene): MemoryScene {
		if (!input || typeof input.chatId !== 'string' || typeof input.title !== 'string' || typeof input.content !== 'string' ||
			!input.content.trim() || !input.title.trim() || input.title.length > 200 || input.content.length > 500_000 ||
			!MEMORY_LEVELS.includes(input.level ?? 'chapter') ||
			(input.children !== undefined && (!Array.isArray(input.children) || input.children.length > 10000 || input.children.some(c => !c || typeof c.id !== 'string' || !Number.isInteger(c.revision) || c.revision < 1))) ||
			!Array.isArray(input.source) || !input.source.length || input.source.length > 10000 ||
			input.source.some((s) => !s || typeof s.id !== 'string' || typeof s.signature !== 'string')) throw new Error('Invalid chapter or source range.');
		return this.inTransaction(() => {
			const scenes = this.getMemoryScenes(input.chatId);
			const previous = input.id ? scenes.find((scene) => scene.id === input.id) : null;
			if (input.id && (!previous || previous.revision !== input.expectedRevision)) throw new Error('This memory changed on another device. Reopen it before saving.');
			if (previous && sceneLevel(previous) !== (input.level ?? 'chapter')) throw new Error('A saved memory cannot change its level.');
			const chat = this.getChat(input.chatId) as { activeLeafId: string | null } | null;
			if (!chat) throw new Error('Chat not found');
			const all = this.getMessagesByChat(input.chatId) as SceneMessage[];
			const path = scenePath(all, chat.activeLeafId);
			const now = Date.now();
			const scene: MemoryScene = { id: input.id ?? randomUUID(), chatId: input.chatId, title: input.title.trim(), content: input.content.trim(),
				source: input.source.map((s) => ({ id: s.id, signature: s.signature })), createdAt: previous?.createdAt ?? now,
				updatedAt: now, revision: (previous?.revision ?? 0) + 1, reviewReason: null, level: input.level ?? 'chapter',
				children: (input.children ?? []).map(c => ({ id: c.id, revision: c.revision })) };
			const candidate = resolveScenes([...scenes.filter(s => s.id !== scene.id), scene], path, all).find(r => r.scene.id === scene.id)!;
			if (candidate.status !== 'active' && candidate.status !== 'covered') throw new Error(`The selected memory changed: ${candidate.reason} Select the sources again.`);
			this.execute(`INSERT INTO memory_scenes (id, chat_id, title, content, source_json, created_at, updated_at, revision, review_reason, level, children_json)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
				ON CONFLICT(id) DO UPDATE SET title=excluded.title, content=excluded.content, source_json=excluded.source_json,
				updated_at=excluded.updated_at, revision=excluded.revision, review_reason=NULL, level=excluded.level, children_json=excluded.children_json`,
				[scene.id, scene.chatId, scene.title, scene.content, JSON.stringify(scene.source), scene.createdAt, now, scene.revision, scene.level!, JSON.stringify(scene.children)]);
			return scene;
		});
	}

	deleteMemoryScene(chatId: string, id: string, expectedRevision: number): void {
		this.inTransaction(() => {
			const scene = this.getMemoryScenes(chatId).find((item) => item.id === id);
			if (!scene || scene.revision !== expectedRevision) throw new Error('This memory changed. Reload Memory before removing it.');
			this.execute('DELETE FROM memory_scenes WHERE id = ? AND chat_id = ?', [id, chatId]);
		});
	}


	// ===== THREADS: audience feeds, independent of the story and memory =====
	getThreadsData(chatId: string): ThreadsData {
		if (!this.getChat(chatId)) throw new Error('Chat not found');
		const notes = this.select<{ notes: string; ao3_json: string; prompt_id: string | null }[]>('SELECT notes, ao3_json, prompt_id FROM threads_notes WHERE chat_id = ?', [chatId])[0];
		return {
			rounds: this.select<{ data_json: string }[]>('SELECT data_json FROM threads_rounds WHERE chat_id = ? ORDER BY created_at, rowid', [chatId]).map(r => JSON.parse(r.data_json)),
			promptId: notes?.prompt_id ?? null, notes: notes?.notes ?? '', ao3: notes ? normalizeAo3Information(JSON.parse(notes.ao3_json)) : emptyAo3Information()
		};
	}
	updateThreadsNotes(chatId: string, patch: ThreadsNotesPatch): void {
		if (!patch || (patch.promptId !== undefined && patch.promptId !== null && (typeof patch.promptId !== 'string' || !patch.promptId || patch.promptId.length > 200)) || (patch.notes !== undefined && (typeof patch.notes !== 'string' || patch.notes.length > 100_000)) ||
			(patch.ao3 !== undefined && JSON.stringify(patch.ao3).length > 100_000)) throw new Error('Invalid Threads notes.');
		this.inTransaction(() => {
			if (!this.getChat(chatId)) throw new Error('Chat not found');
			this.execute('INSERT OR IGNORE INTO threads_notes (chat_id) VALUES (?)', [chatId]);
			if (patch.promptId !== undefined) this.execute('UPDATE threads_notes SET prompt_id = ? WHERE chat_id = ?', [patch.promptId, chatId]);
			if (patch.notes !== undefined) this.execute('UPDATE threads_notes SET notes = ? WHERE chat_id = ?', [patch.notes, chatId]);
			if (patch.ao3 !== undefined) this.execute('UPDATE threads_notes SET ao3_json = ? WHERE chat_id = ?', [JSON.stringify(normalizeAo3Information(patch.ao3)), chatId]);
		});
	}
	private writeThreadsRound(round: ThreadsRound): ThreadsRound {
		this.execute('INSERT INTO threads_rounds (id, chat_id, created_at, data_json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json',
			[round.id, round.chatId, round.createdAt, JSON.stringify(round)]);
		return round;
	}
	saveThreadsRound(input: SaveThreadsRound): ThreadsRound {
		if (!input || typeof input.id !== 'string' || !input.id || typeof input.chatId !== 'string' ||
			typeof input.label !== 'string' || input.label.length > 200 || (input.branchLeafId !== undefined && typeof input.branchLeafId !== 'string') || !Array.isArray(input.messages) ||
			!input.messages.length || input.messages.length > 10000 || input.messages.some(m => !m || typeof m.id !== 'string' ||
				typeof m.content !== 'string' || typeof m.speaker !== 'string' || m.speaker.length > 500 || !Number.isInteger(m.index))) throw new Error('Invalid Threads scene.');
		if (JSON.stringify(input).length > 4_000_000) throw new Error('This thread is too large.');
		const feed = parseGeneratedThreadsFeed(JSON.stringify(input.feed));
		return this.inTransaction(() => {
			const data = this.getThreadsData(input.chatId);
			const existing = data.rounds.find(r => r.id === input.id);
			if (existing) {
				if (existing.label === input.label.trim() && existing.messages.length === input.messages.length && existing.messages.every((m,i) => {
					const source = input.messages[i];
					return m.id === source.id && m.content === source.content && m.role === source.role && m.speaker === source.speaker;
				}) && JSON.stringify(existing.versions[0].feed) === JSON.stringify(feed)) return existing;
				throw new Error('This thread already exists. Reload Threads.');
			}
			if (this.select<{ id: string }[]>('SELECT id FROM threads_rounds WHERE id = ?', [input.id]).length) throw new Error('Thread id already used.');
			const ids = input.messages.map(m => m.id);
			if (new Set(ids).size !== ids.length) throw new Error('Repeated source messages.');
			const all = this.getMessagesByChat(input.chatId) as SceneMessage[];
			const chat = this.getChat(input.chatId) as { activeLeafId: string | null };
			const branchLeafId = input.branchLeafId ?? chat.activeLeafId;
			if (!branchLeafId || !all.some(m => m.id === branchLeafId)) throw new Error('The selected branch changed while generating. Select the scene again.');
			const path = scenePath(all, branchLeafId);
			const wanted = new Set(ids), selected = path.filter(m => wanted.has(m.id));
			if (selected.length !== ids.length || selected.some((m, i) => m.id !== ids[i] || m.content !== input.messages[i].content || m.role !== input.messages[i].role)) {
				throw new Error('Selected messages changed while generating. Select the scene again.');
			}
			if (threadsSelectionOverlaps(data.rounds, input.messages, path, all)) throw new Error('Some messages were already used by another thread on this branch. Select a scene that includes this fork’s own messages.');
			const now = Date.now(), versionId = randomUUID();
			return this.writeThreadsRound({ id: input.id, chatId: input.chatId, label: input.label.trim(), createdAt: now,
				revision: 1, messages: input.messages.map(m => ({ id: m.id, role: m.role, content: m.content, speaker: m.speaker, index: path.findIndex(p => p.id === m.id) })),
				versions: [{ id: versionId, createdAt: now, feed }], activeVersionId: versionId });
		});
	}
	addThreadsVersion(chatId: string, id: string, expectedRevision: number, versionId: string, feed: ThreadsFeed): ThreadsRound {
		const parsed = parseGeneratedThreadsFeed(JSON.stringify(feed));
		return this.inTransaction(() => {
			const round = this.getThreadsData(chatId).rounds.find(r => r.id === id);
			if (!round) throw new Error('This thread was removed.');
			if (round.versions.some(v => v.id === versionId)) return round;
			if (!versionId || round.revision !== expectedRevision) throw new Error('This thread changed on another device. Reload before regenerating.');
			round.versions.push({ id: versionId, createdAt: Date.now(), feed: parsed });
			round.activeVersionId = versionId; round.revision++;
			return this.writeThreadsRound(round);
		});
	}
	setThreadsVersion(chatId: string, id: string, expectedRevision: number, versionId: string): ThreadsRound {
		return this.inTransaction(() => {
			const round = this.getThreadsData(chatId).rounds.find(r => r.id === id);
			if (!round || round.revision !== expectedRevision || !round.versions.some(v => v.id === versionId)) throw new Error('This thread changed. Reload Threads.');
			round.activeVersionId = versionId; round.revision++;
			return this.writeThreadsRound(round);
		});
	}
	resetThreadsContinuity(chatId: string, expected: { id: string; revision: number }[]): void {
		this.inTransaction(() => {
			const rounds = this.getThreadsData(chatId).rounds;
			if (!Array.isArray(expected) || rounds.length !== expected.length ||
				new Set(expected.map(r => r?.id)).size !== expected.length ||
				rounds.some(round => !expected.some(r => r?.id === round.id && r.revision === round.revision))) {
				throw new Error('Threads continuity changed. Reload Threads before resetting it.');
			}
			this.execute('DELETE FROM threads_rounds WHERE chat_id = ?', [chatId]);
		});
	}
	deleteThreadsRound(chatId: string, id: string, expectedRevision: number): void {
		this.inTransaction(() => {
			const round = this.getThreadsData(chatId).rounds.find(r => r.id === id);
			if (!round || round.revision !== expectedRevision) throw new Error('This thread changed. Reload Threads before removing it.');
			this.execute('DELETE FROM threads_rounds WHERE id = ? AND chat_id = ?', [id, chatId]);
		});
	}

	// ===== PROMPT DEBUG LOG (server-internal, used only by server/promptLog.ts, not bridged) =====

	/** Insert one entry and prune the oldest rows past `cap` in the same transaction. */
	insertPromptLogEntry(id: string, startedAt: number, entry: string, cap: number): void {
		this.inTransaction(() => {
			this.execute('INSERT OR REPLACE INTO prompt_log (id, started_at, entry) VALUES (?, ?, ?)', [id, startedAt, entry]);
			this.prunePromptLog(cap);
		});
	}

	prunePromptLog(cap: number): void {
		this.execute(
			'DELETE FROM prompt_log WHERE id IN (SELECT id FROM prompt_log ORDER BY started_at DESC, rowid DESC LIMIT -1 OFFSET ?)',
			[cap]
		);
	}

	getPromptLogIds(): string[] {
		return this.select<{ id: string }[]>('SELECT id FROM prompt_log ORDER BY started_at DESC, rowid DESC').map(row => row.id);
	}

	getPromptLogEntry(id: string): string | null {
		const rows = this.select<{ entry: string }[]>('SELECT entry FROM prompt_log WHERE id = ?', [id]);
		return rows[0]?.entry ?? null;
	}

	updatePromptLogEntry(id: string, entry: string): void {
		this.execute('UPDATE prompt_log SET entry = ? WHERE id = ?', [entry, id]);
	}

	/** Every stored entry, newest first. */
	getAllPromptLogEntries(): string[] {
		return this.select<{ entry: string }[]>('SELECT entry FROM prompt_log ORDER BY started_at DESC, rowid DESC').map((r) => r.entry);
	}

	clearPromptLog(): void {
		this.execute('DELETE FROM prompt_log');
	}

}

export const serverDb = new ServerDatabase();

// Methods the client may invoke over the RPC bridge, grouped by the sync scope a
// successful mutation should broadcast. Read-only methods are not listed here.
// The scope vocabulary lives in shared/sync.ts, so a scope the client cannot handle
// is a compile error here rather than a device that quietly stops refreshing.
export const MUTATION_SCOPES: Record<string, SyncScope> = {
	insertChat: 'chats',
	updateChat: 'chats',
	updateChatActiveLeaf: 'chats',
	updateChatFavorite: 'chats',
	// Bookkeeping the client only ever writes (what the card handed this chat), so the hint
	// it carries costs another device one chat-list refetch and nothing else.
	setChatSeededGreetings: 'chats',
	touchChatActivity: 'chats',
	deleteChat: 'chats',
	// Writes messages (and optionally memory) too, but one method carries one scope and
	// 'chats' is the one that matters: sync.ts reloads chatStore + chatCastStore for it,
	// which is exactly what a new chat needs on another device. A copied chat is never
	// the open chat anywhere, so its memory loads on first open like any other chat's.
	duplicateChat: 'chats',
	branchChat: 'chats',
	insertMessage: 'messages',
	updateMessageContent: 'messages',
	setMessageExcludedFromPrompt: 'messages',
	setMessageBookmarked: 'messages',
	applyMessageContinuation: 'messages',
	updateMessagePersona: 'messages',
	setChatUserPersona: 'messages',
	deleteMessageOnly: 'messages',
	deleteMessageAndDescendants: 'messages',
	deleteDescendants: 'messages',
	setSetting: 'settings',
	deleteSetting: 'settings',
	upsertChatDraft: 'drafts',
	deleteChatDraft: 'drafts',
	addInputHistory: 'inputHistory',
	clearInputHistory: 'inputHistory',
	setConnectionCredentials: 'settings',
	deleteConnectionCredentials: 'settings',
	copyConnectionCredentials: 'settings',
	insertLibraryEntry: 'library',
	updateLibraryEntry: 'library',
	updateCharacterAuthorsNote: 'library',
	updateLibraryEntryFavorite: 'library',
	deleteLibraryEntry: 'library',
	insertCharacterVersion: 'library',
	renameCharacterVersion: 'library',
	deleteCharacterVersion: 'library',
	pinUnpinnedChatsToVersion: 'chats',
	insertLorebook: 'lorebooks',
	updateLorebook: 'lorebooks',
	deleteLorebook: 'lorebooks',
	insertSteeringNote: 'steering',
	updateSteeringNote: 'steering',
	deleteSteeringNote: 'steering',
	consumeSteeringNotes: 'steering',
	reorderSteeringNotes: 'steering',
	saveMemoryScene: 'memory',
	deleteMemoryScene: 'memory',
	saveThreadsRound: 'threads',
	addThreadsVersion: 'threads',
	setThreadsVersion: 'threads',
	deleteThreadsRound: 'threads',
	resetThreadsContinuity: 'threads',
	updateThreadsNotes: 'threads'
};

// Every method the bridge is allowed to dispatch (reads + mutations).
const READ_METHODS = [
	'getAllChats', 'getChat', 'getMessagesByChat', 'getMessagesDelta', 'getMessageCounts', 'getLastPersonaByChat',
	'getLastUserMessageTimes',
	'getChatListStats', 'getChatContentGroups', 'searchChatMessages', 'getChatMemoryFootprint',
	'getMessage', 'getNextSiblingIndex', 'getSetting', 'getAllSettings', 'getChatDraft', 'getInputHistory', 'getConnectionCredentials',
	'getAllLibraryEntries', 'getLibraryEntry',
	'getAllCharacterVersions', 'getCharacterVersion',
	'getAllLorebooks', 'getLorebook',
	'getAllSteeringNotes', 'getMemoryScenes', 'getThreadsData'
];

export const ALLOWED_DB_METHODS = new Set([...READ_METHODS, ...Object.keys(MUTATION_SCOPES)]);

export function callDbMethod(method: string, args: unknown[]): unknown {
	if (!ALLOWED_DB_METHODS.has(method)) {
		throw new Error(`Unknown db method: ${method}`);
	}
	const fn = (serverDb as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
	return fn.apply(serverDb, args);
}
