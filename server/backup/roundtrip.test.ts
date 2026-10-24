import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS_FOR_TESTS } from '../db';
import { removeDatabaseFixture } from '../test-fixtures';
import { createSnapshot } from './snapshot';
import { preparePortableExport, takePreparedExport, importPortableBackup } from './portable';
import { beginRestore, resumeInterruptedRestore } from './restore';
import { referencedImagePaths } from './inventory';

let root: string;
const previousData = process.env.CHUNGUS_DATA_DIR, previousBackup = process.env.CHUNGUS_BACKUP_DIR;
beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'chungus-backup-roundtrip-'));
	process.env.CHUNGUS_DATA_DIR = join(root, 'data'); process.env.CHUNGUS_BACKUP_DIR = join(root, 'backups');
	mkdirSync(join(root, 'data'), { recursive: true });
});
afterAll(() => {
	if (previousData === undefined) delete process.env.CHUNGUS_DATA_DIR; else process.env.CHUNGUS_DATA_DIR = previousData;
	if (previousBackup === undefined) delete process.env.CHUNGUS_BACKUP_DIR; else process.env.CHUNGUS_BACKUP_DIR = previousBackup;
	removeDatabaseFixture(root, 'chungus-backup-roundtrip-');
});

function dump(db: Database): Record<string, unknown[]> {
	const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
	return Object.fromEntries(tables.map(({ name }) => [name, db.query(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
}

test('snapshot, portable ZIP import and restore preserve the complete current database and files', async () => {
	const data = join(root, 'data'), liveFile = join(data, 'chungushub.db');
	const db = new Database(liveFile, { create: true });
	const insert = (table: string, values: Record<string, unknown>) => {
		const keys = Object.keys(values);
		db.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, Object.values(values) as any[]);
	};
	db.exec('CREATE TABLE _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
	for (const migration of MIGRATIONS_FOR_TESTS) {
		db.exec(migration.sql); insert('_migrations', { version: migration.version, name: migration.name, applied_at: 1 });
	}
	insert('chats', { id: 'chat', title: 'Original', created_at: 1, updated_at: 2,
		root_message_id: 'root', active_leaf_id: 'swipe', canon_leaf_id: 'root', feature_state: JSON.stringify({ scene: { background: { path: 'images/backgrounds/scene.png' } }, authorsNote: 'Remember' }) });
	insert('messages', { id: 'root', chat_id: 'chat', role: 'user', content: 'Source', created_at: 1, sibling_index: 0, is_bookmarked: 1 });
	for (const [id, sibling] of [['reply', 0], ['swipe', 1]] as const) insert('messages', { id, chat_id: 'chat', parent_id: 'root', role: 'assistant', content: id,
		created_at: 2, sibling_index: sibling, thinking: 'Thought', reasoning_ms: 17000, excluded_from_prompt: id === 'reply' ? 1 : 0,
		attachments_json: JSON.stringify([{ path: 'images/chat/shared.png' }]) });
	insert('character_library', { id: 'character', type: 'character', data_json: JSON.stringify({ identity: { name: 'Character' }, data: { traits: { description: 'Description' } } }), created_at: 1, updated_at: 2 });
	insert('character_versions', { id: 'version', entry_id: 'character', name: 'Variant', data_json: '{"traits":{"description":"Variant"}}', created_at: 1, updated_at: 2 });
	insert('lorebooks', { id: 'book', data_json: JSON.stringify({ name: 'World', entries: [{ id: 'outlet-entry', position: 7, outletName: 'places', content: 'Castle', key: ['castle'] }] }), created_at: 1, updated_at: 2 });
	insert('steering_notes', { id: 'steer', scope: 'chat', scope_id: 'chat', data_json: '{"text":"Direction","enabled":true,"mode":"once"}', created_at: 1, updated_at: 2 });
	for (const [id, level, children] of [['chapter', 'chapter', []], ['arc', 'arc', [{ id: 'chapter', revision: 1 }]], ['volume', 'volume', [{ id: 'arc', revision: 1 }]]] as const) {
		insert('memory_scenes', { id, chat_id: 'chat', title: id, content: 'Saved summary', source_json: '[{"id":"root","fingerprint":"saved"}]', created_at: 1, updated_at: 2, level, children_json: JSON.stringify(children) });
	}
	insert('memory_scene_migrations', { chat_id: 'chat' });
	insert('threads_rounds', { id: 'thread', chat_id: 'chat', created_at: 2, data_json: '{"versions":[{"id":"feed","post":{"body":"Reaction"}}]}' });
	insert('threads_notes', { chat_id: 'chat', notes: 'Continuity', ao3_json: '{"warnings":["Violence","Major Character Death"]}' });
	insert('settings', { key: 'featurePrompts', value: '{"overrides":{"impersonate":"Custom prompt"}}' });
	insert('settings', { key: 'connections', value: '[{"id":"connection","name":"Custom connection"}]' });
	insert('connection_credentials', { connection_id: 'connection', provider: 'openai-compatible', api_key_encrypted: 'FAKE-FIXTURE-KEY', updated_at: 2 });
	insert('chat_drafts', { chat_id: 'chat', content: 'Unsent', updated_at: 2 });
	insert('input_history', { chat_id: 'chat', content: 'Sent', created_at: 2 });
	const expected = dump(db); db.close();

	const files = { 'images/chat/shared.png': 'SHARED', 'images/backgrounds/scene.png': 'BACKGROUND',
		'presets/custom.json': '{"name":"Custom","items":[{"content":"{{outlet::places}}"}]}',
		'presets/drafts/custom.json': '{"name":"Unsaved","items":[]}', 'custom-fonts/family/font.woff2': 'FONT', 'custom-fonts/family/LICENSE.txt': 'LICENSE' };
	for (const [path, body] of Object.entries(files)) { mkdirSync(join(data, path, '..'), { recursive: true }); writeFileSync(join(data, path), body); }
	const source = await createSnapshot({ kind: 'manual' });
	const prepared = await preparePortableExport(source.id), download = takePreparedExport(prepared.token)!;
	const archive = await new Response(download.body).arrayBuffer();
	const imported = await importPortableBackup(new Response(archive).body);
	const importedFile = join(root, 'backups', imported.id, 'data', 'chungushub.db');
	const copied = new Database(importedFile, { readonly: true });
	try { expect(dump(copied)).toEqual(expected); expect(referencedImagePaths(copied).has('images/backgrounds/scene.png')).toBe(true); }
	finally { copied.close(); }
	const movedOn = new Database(liveFile); movedOn.run("UPDATE messages SET content = 'Newer content'"); movedOn.close();
	writeFileSync(join(data, 'security.json'), '{"keep":"current password settings"}');
	beginRestore(imported.id); await resumeInterruptedRestore();
	const restored = new Database(liveFile, { readonly: true });
	try { expect(dump(restored)).toEqual(expected); } finally { restored.close(); }
	for (const [path, body] of Object.entries(files)) expect(readFileSync(join(data, path), 'utf8')).toBe(body);
	expect(readFileSync(join(data, 'security.json'), 'utf8')).toContain('current password settings');
});
