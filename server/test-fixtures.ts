import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

interface LegacyFixtureDatabase {
	execute(sql: string, values?: any[]): unknown;
	select<T>(sql: string, values?: any[]): T;
}

/** Seed historical rows directly; the retired automatic-memory API must not return for tests. */
export function seedLegacyMemoryState(db: LegacyFixtureDatabase, chatId: string, patch: { enabled?: boolean; autoExtract?: boolean; config?: unknown }) {
	db.execute('INSERT INTO memory_state (chat_id, enabled, auto_extract, config_json, updated_at) VALUES (?, ?, ?, ?, ?)',
		[chatId, patch.enabled ? 1 : 0, patch.autoExtract === false ? 0 : 1, patch.config ? JSON.stringify(patch.config) : null, Date.now()]);
}

export function seedLegacyEpisode(db: LegacyFixtureDatabase, chatId: string, episode: { content: string; sourceMessageIds: string[]; anchorMessageId: string | null; layer?: number }) {
	const id = randomUUID();
	db.execute('INSERT INTO memory_episodes (id, chat_id, layer, content, source_message_ids, anchor_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[id, chatId, episode.layer ?? 0, episode.content, JSON.stringify(episode.sourceMessageIds), episode.anchorMessageId, Date.now()]);
	return id;
}

export function readLegacyMemoryState(db: LegacyFixtureDatabase, chatId: string) {
	const row = db.select<any[]>('SELECT * FROM memory_state WHERE chat_id = ?', [chatId])[0];
	return row ? { enabled: row.enabled === 1, autoExtract: row.auto_extract !== 0, config: row.config_json ? JSON.parse(row.config_json) : null } : null;
}

export function readLegacyEpisodes(db: LegacyFixtureDatabase, chatId: string) {
	return db.select<any[]>('SELECT * FROM memory_episodes WHERE chat_id = ? ORDER BY layer, created_at, rowid', [chatId])
		.map(row => ({ id: row.id, layer: row.layer, content: row.content, sourceMessageIds: JSON.parse(row.source_message_ids), anchorMessageId: row.anchor_message_id }));
}

/** Remove only the calling test's throwaway database directory. */
export function removeDatabaseFixture(dir: string, prefix: string): void {
	const absolute = resolve(dir);
	if (!prefix.startsWith('chungus-') || !absolute.startsWith(resolve(tmpdir()) + sep) ||
		!basename(absolute).startsWith(prefix)) throw new Error('Unsafe test data path');
	try {
		rmSync(absolute, { recursive: true, force: true });
	} catch (error) {
		// Bun 1.3.9 retains SQLite transaction handles after close(). Windows cannot
		// unlink those files until this process exits (see architecture/backups.md).
		// This is test teardown only: permission/path/IO errors must still fail.
		if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
		console.warn(`[test cleanup] Windows still holds the temporary SQLite database: ${absolute}`);
	}
}
