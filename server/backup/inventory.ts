/** Inventory the copied database, never the live server singleton. */
import type { Database } from 'bun:sqlite';
import type { SnapshotSummary } from '../../shared/backups';
export { referencedImagePaths, referencedImagePathsInText } from '../image-references';

function count(db: Database, table: string, where = ''): number {
	if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) return 0;
	return (db.query(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number }).n;
}

export function summarize(db: Database, imageCount: number, presetCount: number): SnapshotSummary {
	return {
		chats: count(db, 'chats'), messages: count(db, 'messages'),
		characters: count(db, 'character_library', "WHERE type = 'character'"),
		personas: count(db, 'character_library', "WHERE type = 'persona'"),
		lorebooks: count(db, 'lorebooks'), presets: presetCount, images: imageCount
	};
}
