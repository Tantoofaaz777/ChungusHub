/** Shared reference inventory for backup reconciliation and conservative file cleanup. */
import type { Database } from 'bun:sqlite';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS_DIR } from './config';

const IMAGE_PATH_RE = /images\/(?:characters|personas|backgrounds|chat|presets|lorebooks)\/(?:thumbnails\/)?[^"\\/\r\n<>]*?\.(?:png|jpe?g|jfif|webp|gif|avif)(?=$|["'\s)\]}>?,;])/gi;
const WHOLE_IMAGE_PATH_RE = new RegExp(`^(?:${IMAGE_PATH_RE.source})$`, 'i');
const COLUMNS = [
	['messages', 'attachments_json', true], ['messages', 'content', false],
	['character_library', 'data_json', true], ['character_versions', 'data_json', true],
	['lorebooks', 'data_json', true], ['settings', 'value', false],
	['chats', 'settings_json', true], ['chats', 'feature_state', true]
] as const;

export function referencedImagePathsInText(text: string, requireJson = false): Set<string> {
	const found = new Set<string>();
	const scan = (value: unknown) => {
		if (typeof value === 'string') {
			if (WHOLE_IMAGE_PATH_RE.test(value)) found.add(value);
			for (const match of value.matchAll(IMAGE_PATH_RE)) found.add(match[0]);
		} else if (value && typeof value === 'object') {
			for (const child of Object.values(value)) scan(child);
		}
	};
	try { scan(JSON.parse(text)); }
	catch (error) { if (requireJson) throw error; scan(text); }
	return found;
}

export function referencedImagePaths(db: Database, strict = false): Set<string> {
	const found = new Set<string>();
	for (const [table, column, json] of COLUMNS) {
		if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)) continue;
		const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
		if (!columns.some(row => row.name === column)) continue;
		// Message bodies can dwarf attachment metadata; ordinary prose cannot own an
		// image, so keep it out of the allocation/parse pass.
		const filter = table === 'messages' && column === 'content' ? " AND instr(content, 'images/') > 0" : '';
		const rows = db.query(`SELECT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL${filter}`).all() as { value: unknown }[];
		for (const { value } of rows) if (typeof value === 'string') {
			for (const path of referencedImagePathsInText(value, json && strict)) found.add(path);
		}
	}
	return found;
}

/** Drafts and committed presets both own their covers. An unreadable file stops cleanup. */
export function referencedPresetImages(root = PRESETS_DIR): Set<string> {
	const found = new Set<string>();
	if (!existsSync(root)) return found;
	if (lstatSync(root).isSymbolicLink()) throw new Error('Cannot inspect a linked preset directory.');
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink()) throw new Error('Cannot inspect a linked preset file.');
		const references = entry.isDirectory() ? referencedPresetImages(path)
			: entry.isFile() && entry.name.endsWith('.json') ? referencedImagePathsInText(readFileSync(path, 'utf8'), true) : [];
		for (const reference of references) found.add(reference);
	}
	return found;
}
