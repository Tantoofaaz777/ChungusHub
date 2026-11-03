import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { planConversationMigration, type ConfirmedSwipeGroup, type PlannedConversation } from '../shared/conversation-migration';
import type { ConversationPlacement, VariantSelection } from '../shared/conversation';
import type { RecoveredGeneration } from '../shared/recovered-generation';

export class ConversationRecoveryError extends Error {
	constructor(public chatId: string, public recoveryId: string, reason: string) {
		super(`${reason} The generated text was saved for recovery. Open Recovered responses in Chat actions.`);
		this.name = 'ConversationRecoveryError';
	}
}

type Row = Record<string, any>;
export const VARIANT_COLUMNS = ['content', 'created_at', 'edited_at', 'model', 'provider', 'tokens_prompt',
	'tokens_completion', 'finish_reason', 'thinking', 'persona_id', 'branch_label', 'attachments_json',
	'generation_ms', 'minor_edited_at', 'sprite_label', 'first_token_ms', 'reasoning_ms', 'lore_json',
	'excluded_from_prompt', 'is_bookmarked'] as const;
export function variantPayload(input: Row, baseline: Row = {}): Row {
	const names: Record<string, string> = { created_at: 'createdAt', edited_at: 'editedAt', tokens_prompt: 'tokensPrompt',
		tokens_completion: 'tokensCompletion', finish_reason: 'finishReason', persona_id: 'personaId',
		generation_ms: 'generationMs', minor_edited_at: 'minorEditedAt', sprite_label: 'spriteLabel',
		first_token_ms: 'firstTokenMs', reasoning_ms: 'reasoningMs', branch_label: 'branchLabel',
		attachments_json: 'attachments', lore_json: 'lorebook', excluded_from_prompt: 'excludedFromPrompt', is_bookmarked: 'isBookmarked' };
	const row = { ...baseline };
	for (const column of VARIANT_COLUMNS) {
		const key = names[column] ?? column;
		if (input[key] === undefined) continue;
		row[column] = ['branch_label', 'attachments_json', 'lore_json'].includes(column)
			? input[key] === null ? null : JSON.stringify(input[key])
			: ['excluded_from_prompt', 'is_bookmarked'].includes(column) ? input[key] ? 1 : 0 : input[key];
	}
	row.created_at ??= Date.now();
	row.excluded_from_prompt ??= 0; row.is_bookmarked ??= 0;
	return row;
}
const projectedPayload = `json_object(${VARIANT_COLUMNS.map(column => `'${column}', NEW.${column}`).join(', ')})`;

/** Selected payload columns remain a SQL projection for existing prompt/retention readers. */
export const CONVERSATION_SCHEMA = `
ALTER TABLE chats ADD COLUMN conversation_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN position INTEGER;
ALTER TABLE messages ADD COLUMN selected_variant_id TEXT;
CREATE UNIQUE INDEX idx_message_position ON messages(chat_id, position) WHERE position IS NOT NULL;
CREATE TABLE message_variants (
	id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
	ordinal INTEGER NOT NULL CHECK (ordinal >= 0), payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
	UNIQUE(message_id, ordinal)
);
CREATE TABLE conversation_archives (
	id TEXT PRIMARY KEY, source_chat_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE conversation_provenance (
	chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
	archive_id TEXT NOT NULL REFERENCES conversation_archives(id), source_leaf_id TEXT, unclassified_json TEXT NOT NULL
);
CREATE TABLE conversation_mappings (
	chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, legacy_message_id TEXT NOT NULL,
	message_id TEXT NOT NULL, variant_id TEXT NOT NULL, PRIMARY KEY(chat_id, legacy_message_id)
);
CREATE TABLE conversation_generation_recovery (
	id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL, reason TEXT NOT NULL, payload_json TEXT NOT NULL
);
CREATE TRIGGER conversation_append_guard BEFORE INSERT ON messages
WHEN (SELECT conversation_version FROM chats WHERE id = NEW.chat_id) = 2
BEGIN
	SELECT CASE WHEN NEW.parent_id IS NOT (SELECT id FROM messages WHERE chat_id = NEW.chat_id ORDER BY position DESC LIMIT 1)
		THEN RAISE(ABORT, 'A turn must append to the conversation endpoint; use a variant or a new chat.') END;
END;
CREATE TRIGGER conversation_variant_insert AFTER INSERT ON messages
WHEN (SELECT conversation_version FROM chats WHERE id = NEW.chat_id) = 2
BEGIN
	UPDATE messages SET position = COALESCE(NEW.position,
		(SELECT COALESCE(MAX(position), -1) + 1 FROM messages WHERE chat_id = NEW.chat_id AND id != NEW.id)),
		selected_variant_id = COALESCE(NEW.selected_variant_id, NEW.id) WHERE id = NEW.id;
	INSERT INTO message_variants(id, message_id, ordinal, payload_json)
		VALUES (COALESCE(NEW.selected_variant_id, NEW.id), NEW.id, 0, ${projectedPayload});
END;
CREATE TRIGGER conversation_variant_projection AFTER UPDATE OF ${VARIANT_COLUMNS.join(', ')} ON messages
WHEN NEW.selected_variant_id IS NOT NULL
BEGIN
	UPDATE message_variants SET payload_json = json_patch(payload_json, ${projectedPayload})
		WHERE id = NEW.selected_variant_id AND message_id = NEW.id;
END;
CREATE TRIGGER conversation_selection_guard BEFORE UPDATE OF selected_variant_id ON messages
WHEN OLD.selected_variant_id IS NOT NULL AND NEW.selected_variant_id IS NOT OLD.selected_variant_id
BEGIN
	SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM message_variants WHERE id = NEW.selected_variant_id AND message_id = NEW.id)
		THEN RAISE(ABORT, 'Selected variant must belong to its turn.') END;
END;
CREATE TRIGGER conversation_selected_variant_delete BEFORE DELETE ON message_variants
WHEN EXISTS (SELECT 1 FROM messages WHERE id = OLD.message_id AND selected_variant_id = OLD.id)
BEGIN
	SELECT RAISE(ABORT, 'Select another version or delete the turn before removing its selected variant.');
END;
CREATE TRIGGER conversation_variant_role_guard BEFORE INSERT ON message_variants
WHEN (SELECT role FROM messages WHERE id = NEW.message_id) != 'assistant'
	AND EXISTS (SELECT 1 FROM message_variants WHERE message_id = NEW.message_id)
BEGIN
	SELECT RAISE(ABORT, 'Only assistant turns can have multiple versions.');
END;
CREATE TRIGGER conversation_variant_owner_guard BEFORE UPDATE OF message_id ON message_variants
WHEN NEW.message_id != OLD.message_id
BEGIN
	SELECT RAISE(ABORT, 'A variant cannot move to another turn.');
END;
CREATE TRIGGER conversation_variant_mapping_delete AFTER DELETE ON message_variants
BEGIN
	DELETE FROM conversation_mappings WHERE variant_id = OLD.id;
END;
`;

/** All methods run on the server's existing synchronous connection/transaction. */
export class ConversationStorage {
	constructor(private db: Database) {}
	private all(sql: string, args: unknown[] = []): Row[] { return this.db.query(sql).all(...args as never[]) as Row[]; }
	private one(sql: string, args: unknown[] = []): Row | undefined { return this.all(sql, args)[0]; }
	private run(sql: string, args: unknown[] = []): void { this.db.query(sql).run(...args as never[]); }
	private insert(table: string, row: Row): void {
		const columns = Object.keys(row);
		this.run(`INSERT INTO ${table} (${columns.map(c => `"${c.replaceAll('"', '""')}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`, Object.values(row));
	}
	modern(chatId: string): boolean {
		return this.one('SELECT conversation_version FROM chats WHERE id = ?', [chatId])?.conversation_version === 2;
	}
	variants(messageId: string): Row[] {
		return this.all('SELECT * FROM message_variants WHERE message_id = ? ORDER BY ordinal', [messageId])
			.map(row => ({ ...JSON.parse(row.payload_json), id: row.id, message_id: messageId, ordinal: row.ordinal }));
	}
	variantRows(chatId: string): Row[] {
		return this.all('SELECT v.* FROM message_variants v JOIN messages m ON m.id = v.message_id WHERE m.chat_id = ? ORDER BY v.ordinal', [chatId]);
	}
	private turn(id: string): Row {
		const row = this.one('SELECT * FROM messages WHERE id = ?', [id]);
		if (!row || !row.selected_variant_id) throw new Error('The conversation turn is unavailable.');
		return row;
	}
	private bump(chatId: string): number {
		return this.one('UPDATE chats SET messages_rev = messages_rev + 1 WHERE id = ? RETURNING messages_rev', [chatId])!.messages_rev;
	}
	private project(turn: Row, variantId: string, payload: Row, rev: number): void {
		this.run(`UPDATE messages SET selected_variant_id = ?, ${VARIANT_COLUMNS.map(c => `${c} = ?`).join(', ')}, rev = ? WHERE id = ?`,
			[variantId, ...VARIANT_COLUMNS.map(c => payload[c] ?? (c === 'excluded_from_prompt' || c === 'is_bookmarked' ? 0 : null)), rev, turn.id]);
	}
	private endpoint(chatId: string): Row | undefined {
		return this.one('SELECT * FROM messages WHERE chat_id = ? ORDER BY position DESC LIMIT 1', [chatId]);
	}
	private assertLast(turn: Row): void {
		if (this.endpoint(turn.chat_id)?.id !== turn.id || turn.role !== 'assistant' || turn.excluded_from_prompt) {
			throw new Error('Swipes belong to the last included assistant turn.');
		}
	}
	context(chatId: string, operation: ConversationPlacement['operation']): ConversationPlacement {
		if (!this.modern(chatId)) throw new Error('This chat requires conversation migration.');
		const chat = this.one('SELECT * FROM chats WHERE id = ?', [chatId])!;
		const turns = this.all('SELECT * FROM messages WHERE chat_id = ? ORDER BY position', [chatId]);
		const last = turns.at(-1);
		if (operation !== 'append' && (!last || last.role !== 'assistant')) throw new Error('No assistant turn to swipe.');
		const context = operation === 'append' ? turns : turns.slice(0, -1);
		const contextFingerprint = createHash('sha256').update(JSON.stringify(context.map(turn =>
			[turn.id, turn.role, turn.selected_variant_id, ...VARIANT_COLUMNS.filter(c => c !== 'is_bookmarked').map(c => turn[c])]))).digest('hex');
		return { operation, messageId: operation === 'append' ? null : last!.id, expectedLeafId: last?.id ?? null,
			expectedVariantId: last?.selected_variant_id ?? null, expectedRevision: chat.messages_rev, contextFingerprint,
			...(operation === 'replace_variants' ? { replaceVariantIds: this.variants(last!.id).map(v => v.id) } : {}) };
	}
	select(input: VariantSelection): void {
		const turn = this.turn(input.messageId);
		if (turn.chat_id !== input.chatId) throw new Error('Variant belongs to another chat.');
		this.assertLast(turn);
		if (turn.rev !== input.expectedRevision) throw new Error('The selected response changed. Reload before selecting a swipe.');
		const variant = this.variants(turn.id).find(v => v.id === input.variantId);
		if (!variant) throw new Error('Variant belongs to another turn or is unavailable.');
		if (variant.id === turn.selected_variant_id) return;
		this.project(turn, variant.id, variant, this.bump(turn.chat_id));
	}
	add(messageId: string, payload: Row, select = true): string {
		const turn = this.turn(messageId);
		this.assertLast(turn);
		const id = randomUUID();
		const ordinal = this.one('SELECT COALESCE(MAX(ordinal), -1) + 1 AS n FROM message_variants WHERE message_id = ?', [messageId])!.n;
		this.insert('message_variants', { id, message_id: messageId, ordinal, payload_json: JSON.stringify(payload) });
		const rev = this.bump(turn.chat_id);
		if (select) this.project(turn, id, payload, rev);
		else this.run('UPDATE messages SET rev = ? WHERE id = ?', [rev, messageId]);
		return id;
	}
	remove(input: VariantSelection): string[] {
		const turn = this.turn(input.messageId);
		if (turn.chat_id !== input.chatId || turn.rev !== input.expectedRevision) throw new Error('The conversation changed before deletion.');
		this.assertLast(turn);
		const variants = this.variants(turn.id), doomed = variants.find(v => v.id === input.variantId);
		if (!doomed) throw new Error('Variant is unavailable.');
		if (variants.length === 1) throw new Error('Delete the turn to remove its last variant.');
		const rev = this.bump(turn.chat_id);
		if (turn.selected_variant_id === doomed.id) {
			const next = variants[variants.indexOf(doomed) + 1] ?? variants[variants.indexOf(doomed) - 1];
			this.project(turn, next.id, next, rev);
		} else this.run('UPDATE messages SET rev = ? WHERE id = ?', [rev, turn.id]);
		this.run('DELETE FROM message_variants WHERE id = ? AND message_id = ?', [doomed.id, turn.id]);
		return this.images(doomed);
	}
	images(payload: Row): string[] {
		try { return (JSON.parse(payload.attachments_json ?? '[]') as { path: string }[]).map(a => a.path); } catch { return []; }
	}
	/** A stale completed generation is durable even if prompt logging is disabled. */
	recover(chatId: string, reason: string, payload: unknown): string {
		const id = randomUUID();
		this.insert('conversation_generation_recovery', { id, chat_id: chatId, created_at: Date.now(), reason, payload_json: JSON.stringify(payload) });
		return id;
	}
	getRecovery(chatId: string): RecoveredGeneration[] {
		return this.all('SELECT * FROM conversation_generation_recovery WHERE chat_id = ? ORDER BY created_at', [chatId])
			.map(row => ({ id: row.id, chatId, createdAt: row.created_at, reason: row.reason, payload: JSON.parse(row.payload_json) }));
	}
	discardRecovery(chatId: string, id: string): void { this.run('DELETE FROM conversation_generation_recovery WHERE chat_id = ? AND id = ?', [chatId, id]); }

	/** Compatibility provenance must not become an undelete copy of explicitly removed text. */
	pruneArchives(): void {
		this.run('DELETE FROM conversation_archives WHERE id NOT IN (SELECT archive_id FROM conversation_provenance)');
		for (const archive of this.all('SELECT id, payload_json FROM conversation_archives')) {
			const retained = new Set(this.all(`SELECT m.legacy_message_id FROM conversation_mappings m
				JOIN conversation_provenance p ON p.chat_id = m.chat_id WHERE p.archive_id = ?`, [archive.id]).map(m => m.legacy_message_id));
			const payload = JSON.parse(archive.payload_json);
			const messages = payload.messages.filter((message: Row) => retained.has(message.id));
			if (messages.length !== payload.messages.length) this.run('UPDATE conversation_archives SET payload_json = ? WHERE id = ?',
				[JSON.stringify({ ...payload, messages }), archive.id]);
		}
	}

	refreshGreetings(chatId: string, claimed: string[], greetings: string[]): boolean {
		const turns = this.all('SELECT * FROM messages WHERE chat_id = ? ORDER BY position', [chatId]);
		if (!turns.length) {
			if (claimed.length) return false;
			return true; // The caller seeds an empty chat if a card has just gained an opening.
		}
		if (turns.length !== 1 || turns[0].role !== 'assistant') return false;
		const turn = turns[0], variants = this.variants(turn.id);
		if (variants.length !== claimed.length || variants.some((variant, index) => variant.content !== claimed[index] ||
			variant.edited_at || variant.minor_edited_at || variant.attachments_json)) return false;
		const rev = this.bump(chatId);
		if (!greetings.length) {
			this.run('INSERT INTO message_tombstones(chat_id, message_id, rev) VALUES (?, ?, ?)', [chatId, turn.id, rev]);
			this.run('DELETE FROM messages WHERE id = ?', [turn.id]);
			this.run('UPDATE chats SET root_message_id = NULL, active_leaf_id = NULL, canon_leaf_id = NULL WHERE id = ?', [chatId]);
			return true;
		}
		const kept = Math.min(variants.length, greetings.length);
		for (let i = 0; i < kept; i++) {
			variants[i].content = greetings[i];
			this.run('UPDATE message_variants SET payload_json = ? WHERE id = ?', [JSON.stringify(variants[i]), variants[i].id]);
		}
		for (let i = kept; i < greetings.length; i++) {
			const id = randomUUID(), payload = variantPayload({ content: greetings[i] });
			this.insert('message_variants', { id, message_id: turn.id, ordinal: i, payload_json: JSON.stringify(payload) });
			variants.push({ ...payload, id });
		}
		const selected = variants.slice(0, greetings.length).find(v => v.id === turn.selected_variant_id) ?? variants[0];
		this.project(turn, selected.id, selected, rev);
		for (const dropped of variants.slice(greetings.length)) this.run('DELETE FROM message_variants WHERE id = ?', [dropped.id]);
		return true;
	}

	/** Called before the schema checkpoint and before the server accepts connections. */
	migrateAll(): void {
		for (const chat of this.all('SELECT id FROM chats WHERE conversation_version = 1')) this.migrate(chat.id);
	}
	migrate(chatId: string, confirmedSwipes: readonly ConfirmedSwipeGroup[] = []): void {
		if (this.modern(chatId)) return;
		const chat = this.one('SELECT * FROM chats WHERE id = ?', [chatId]);
		if (!chat) throw new Error('Legacy chat is unavailable.');
		const rows = this.all('SELECT * FROM messages WHERE chat_id = ?', [chatId]);
		const plan = planConversationMigration({ chatId, activeLeafId: chat.active_leaf_id, rootMessageId: chat.root_message_id,
			canonLeafId: chat.canon_leaf_id, messages: rows.map(row => ({ id: row.id, chatId, parentId: row.parent_id,
				role: row.role, siblingIndex: row.sibling_index, createdAt: row.created_at })) }, confirmedSwipes);
		const tables = ['memory_scenes', 'threads_rounds', 'threads_notes', 'memory_state', 'memory_episodes', 'chat_drafts'];
		const archive: Row = { chat, messages: rows };
		for (const table of tables) archive[table] = this.all(`SELECT * FROM ${table} WHERE chat_id = ?`, [chatId]);
		archive.steering_notes = this.all("SELECT * FROM steering_notes WHERE scope = 'chat' AND scope_id = ?", [chatId]);
		const archiveId = randomUUID();
		this.insert('conversation_archives', { id: archiveId, source_chat_id: chatId, payload_json: JSON.stringify(archive), created_at: Date.now() });
		for (const table of ['memory_scenes', 'threads_rounds', 'memory_episodes']) this.run(`DELETE FROM ${table} WHERE chat_id = ?`, [chatId]);
		this.run('DELETE FROM messages WHERE chat_id = ?', [chatId]);
		this.run('DELETE FROM message_tombstones WHERE chat_id = ?', [chatId]);
		this.run('UPDATE chats SET conversation_version = 2, root_message_id = NULL, active_leaf_id = NULL, seeded_greetings = NULL, messages_rev = messages_rev + 1 WHERE id = ?', [chatId]);
		const byId = new Map(rows.map(row => [row.id, row]));
		const materialize = (conversation: PlannedConversation, destination: string, primary: boolean): void => {
			const mappings = new Map<string, { id: string; variantId: string; selected: boolean }>();
			let parent: string | null = null;
			const rev = primary ? chat.messages_rev + 1 : 1;
			for (let position = 0; position < conversation.turns.length; position++) {
				const turn = conversation.turns[position], raw = byId.get(turn.selectedMessageId)!;
				const id = primary ? raw.id : randomUUID(), selectedId = randomUUID();
				this.insert('messages', { ...raw, id, chat_id: destination, parent_id: parent, sibling_index: 0,
					position, selected_variant_id: selectedId, rev });
				// Keep complete raw payloads, including unknown legacy columns, in each version.
				this.run('UPDATE message_variants SET payload_json = ? WHERE id = ?', [JSON.stringify(raw), selectedId]);
				this.run('UPDATE message_variants SET ordinal = ? WHERE id = ?', [turn.variantMessageIds.length, selectedId]);
				for (let ordinal = 0; ordinal < turn.variantMessageIds.length; ordinal++) {
					const legacyId = turn.variantMessageIds[ordinal], selected = legacyId === raw.id;
					const variantId = selected ? selectedId : randomUUID();
					if (!selected) this.insert('message_variants', { id: variantId, message_id: id,
						ordinal, payload_json: JSON.stringify(byId.get(legacyId)) });
					mappings.set(legacyId, { id, variantId, selected });
					this.insert('conversation_mappings', { chat_id: destination, legacy_message_id: legacyId, message_id: id, variant_id: variantId });
				}
				this.run('UPDATE message_variants SET ordinal = ? WHERE id = ?', [turn.variantMessageIds.indexOf(raw.id), selectedId]);
				parent = id;
			}
			const first = conversation.turns[0];
			this.run('UPDATE chats SET root_message_id = ?, active_leaf_id = ?, canon_leaf_id = NULL, messages_rev = ? WHERE id = ?',
				[first ? mappings.get(first.selectedMessageId)!.id : null, parent, rev, destination]);
			this.insert('conversation_provenance', { chat_id: destination, archive_id: archiveId,
				source_leaf_id: conversation.sourceLeafId, unclassified_json: JSON.stringify(plan.unclassifiedAlternatives) });
			this.remapContext(archive, destination, mappings, primary);
		};
		materialize(plan.primary, chatId, true);
		for (const [index, branch] of plan.branches.entries()) {
			const id = randomUUID();
			this.insert('chats', { ...chat, id, title: `${chat.title} (legacy branch ${index + 1})`, created_at: Date.now(), updated_at: Date.now(),
				root_message_id: null, active_leaf_id: null, canon_leaf_id: null, is_favorite: 0, seeded_greetings: null, messages_rev: 0, conversation_version: 2 });
			for (const note of archive.steering_notes) this.insert('steering_notes', { ...note, id: randomUUID(), scope_id: id });
			materialize(branch, id, false);
		}
		const count = this.one('SELECT COUNT(DISTINCT legacy_message_id) AS n FROM conversation_mappings WHERE chat_id IN (SELECT chat_id FROM conversation_provenance WHERE archive_id = ?)', [archiveId])!.n;
		if (count !== rows.length) throw new Error('Migration did not preserve every source message.');
	}
	private remapContext(archive: Row, chatId: string, mappings: Map<string, { id: string; variantId: string; selected: boolean }>, primary: boolean): void {
		const scenes: Row[] = [];
		for (const scene of archive.memory_scenes) {
			try {
				const source = JSON.parse(scene.source_json);
				if (!Array.isArray(source) || !source.length || source.some(ref => !mappings.has(ref.id))) continue;
				scenes.push({ ...scene, id: primary ? scene.id : randomUUID(), chat_id: chatId,
					source_json: JSON.stringify(source.map(ref => ({ ...ref, id: mappings.get(ref.id)!.id, variantId: mappings.get(ref.id)!.variantId }))), originalId: scene.id });
			} catch { /* Original unparseable/incomplete coverage remains in the compatibility archive. */ }
		}
		const sceneIds = new Map(scenes.map(scene => [scene.originalId, scene.id]));
		for (const scene of scenes) {
			const { originalId: _originalId, ...row } = scene;
			try {
				row.children_json = JSON.stringify(JSON.parse(row.children_json).map((ref: Row) => ({ ...ref, id: sceneIds.get(ref.id) ?? `missing:${ref.id}` })));
			} catch { row.review_reason ??= 'Legacy dependency references could not be converted.'; }
			this.insert('memory_scenes', row);
		}
		for (const stored of archive.threads_rounds) {
			try {
				const round = JSON.parse(stored.data_json);
				if (!Array.isArray(round.messages) || !round.messages.length || round.messages.some((ref: Row) => !mappings.get(ref.id)?.selected)) continue;
				round.id = primary ? round.id : randomUUID(); round.chatId = chatId;
				round.messages = round.messages.map((ref: Row) => ({ ...ref, id: mappings.get(ref.id)!.id, variantId: mappings.get(ref.id)!.variantId }));
				this.insert('threads_rounds', { ...stored, id: round.id, chat_id: chatId, data_json: JSON.stringify(round) });
			} catch { /* Preserve the raw row in the archive without inventing active reactions. */ }
		}
		if (!primary) {
			for (const table of ['memory_state', 'threads_notes']) for (const row of archive[table]) this.insert(table, { ...row, chat_id: chatId });
		}
		this.run('INSERT OR IGNORE INTO memory_scene_migrations(chat_id) VALUES (?)', [chatId]);
	}
}
