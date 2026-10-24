import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';

let root: string, images: string, presets: string, db: any;
const written: string[] = [];
const tag = crypto.randomUUID();
// config.ts binds filesystem roots at import time while the DB resolves its path later.
// A fresh process is required: another suite may already have cached those roots.
if (process.env.CHUNGUS_ATTACHMENT_AUDIT_CHILD !== '1') {
	test('attachment cleanup runs against an isolated database and filesystem', async () => {
		const child = Bun.spawn([process.execPath, 'test', import.meta.path, '--timeout', '30000'], {
			env: { ...process.env, CHUNGUS_ATTACHMENT_AUDIT_CHILD: '1' }, stdout: 'pipe', stderr: 'pipe'
		});
		const [status, output] = await Promise.all([child.exited, new Response(child.stderr).text(), new Response(child.stdout).text()]);
		if (status !== 0) throw new Error(output);
		expect(status).toBe(0);
	});
} else {
beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'chungus-attachment-audit-'));
	process.env.CHUNGUS_DATA_DIR = root;
	({ IMAGES_ROOT: images, PRESETS_DIR: presets } = await import('./config'));
	db = (await import('./db')).serverDb; db.closeForTests(); db.open();
});
afterAll(() => {
	db.closeForTests();
	for (const path of written) rmSync(path, { force: true });
	removeDatabaseFixture(root, 'chungus-attachment-audit-');
});
function file(name: string, age = 7200): string {
	const rel = `images/chat/${tag}-${name}.png`, abs = join(images, 'chat', `${tag}-${name}.png`);
	mkdirSync(join(images, 'chat'), { recursive: true }); writeFileSync(abs, 'IMAGE'); written.push(abs);
	const time = new Date(Date.now() - age * 1000); utimesSync(abs, time, time); return rel;
}
const has = (path: string) => existsSync(join(images, path.slice('images/'.length)));
function chat(id: string, path: string) {
	db.insertChat({ id, title: id, createdAt: 1, updatedAt: 1 });
	db.insertMessage({ id: `${id}-message`, chatId: id, role: 'user', content: 'Image', parentId: null,
		createdAt: 1, siblingIndex: 0, attachments: [{ kind: 'image', path }] });
}

test('deleting chats preserves shared attachments until the last row disappears', () => {
	const path = file('shared'); chat('shared-a', path); chat('shared-b', path);
	db.deleteChat('shared-a'); expect(has(path)).toBe(true);
	db.deleteChat('shared-b'); expect(has(path)).toBe(false);
});

test('chat deletion and boot cleanup preserve images named by character versions', () => {
	const path = file('version'); chat('version-chat', path);
	db.insertLibraryEntry({ id: 'version-owner', type: 'character', identity: { name: 'Owner' }, data: { traits: {} }, createdAt: 1, updatedAt: 1 });
	db.insertCharacterVersion({ id: 'saved-version', entryId: 'version-owner', name: 'Saved', data: { cardMetadata: { backgroundPath: path } }, createdAt: 1, updatedAt: 1 });
	db.deleteChat('version-chat'); expect(has(path)).toBe(true);
	db.sweepAbandonedChatImages(); expect(has(path)).toBe(true);
	expect(db.deleteUnusedImage(path)).toBe(false);
});

test('draft preset covers and escaped JSON references protect chat images too', () => {
	const path = file('preset'), settingPath = file('setting'); chat('preset-chat', path);
	const preset = join(presets, 'temp', `${tag}.json`); mkdirSync(join(presets, 'temp'), { recursive: true });
	writeFileSync(preset, JSON.stringify({ meta: { cover: path } })); written.push(preset);
	db.setSetting('attachment-audit-reference', JSON.stringify({ image: settingPath }).replaceAll('/', '\\/'));
	db.deleteChat('preset-chat'); db.sweepAbandonedChatImages();
	expect(has(path)).toBe(true); expect(has(settingPath)).toBe(true);
	rmSync(preset); expect(db.deleteUnusedImage(path)).toBe(true);
});

test('boot cleanup removes old abandoned originals and thumbnails, but keeps recent uploads', () => {
	const old = file('abandoned'), recent = file('recent', 0);
	const thumb = join(images, 'chat', 'thumbnails', `${tag}-thumbnail-only.webp`);
	mkdirSync(join(images, 'chat', 'thumbnails'), { recursive: true }); writeFileSync(thumb, 'THUMB'); written.push(thumb);
	const time = new Date(Date.now() - 7200_000); utimesSync(thumb, time, time);
	db.sweepAbandonedChatImages(); expect(has(old)).toBe(false); expect(has(recent)).toBe(true); expect(existsSync(thumb)).toBe(false);
});

test('a malformed persisted reference aborts cleanup instead of guessing', () => {
	const path = file('uncertain');
	db.insertLibraryEntry({ id: 'corrupt-owner', type: 'character', identity: { name: 'Corrupt' }, data: {}, createdAt: 1, updatedAt: 1 });
	db.execute('UPDATE character_library SET data_json = ? WHERE id = ?', ['{', 'corrupt-owner']);
	try { expect(db.sweepAbandonedChatImages()).toBe(0); expect(has(path)).toBe(true); }
	finally { db.execute('DELETE FROM character_library WHERE id = ?', ['corrupt-owner']); }
});

test('a persisted thumbnail reference protects both the thumbnail and its original', () => {
	const path = file('thumbnail-owner'), name = path.slice(path.lastIndexOf('/') + 1).replace('.png', '.webp');
	const thumbnail = `images/chat/thumbnails/${name}`, abs = join(images, 'chat', 'thumbnails', name);
	mkdirSync(join(images, 'chat', 'thumbnails'), { recursive: true }); writeFileSync(abs, 'THUMB'); written.push(abs);
	db.setSetting('attachment-audit-thumbnail', JSON.stringify({ thumbnail }));
	db.sweepAbandonedChatImages(); expect(has(path)).toBe(true); expect(has(thumbnail)).toBe(true);
	expect(db.deleteUnusedImage(path)).toBe(false);
});

test('an unreadable preset aborts cleanup without deleting an old unused original', () => {
	const path = file('uncertain-preset'), preset = join(presets, `${tag}-broken.json`);
	mkdirSync(presets, { recursive: true }); writeFileSync(preset, '{'); written.push(preset);
	try { expect(db.sweepAbandonedChatImages()).toBe(0); expect(has(path)).toBe(true); }
	finally { rmSync(preset); }
});

test('a message with a Markdown image link owns the file even without attachment metadata', () => {
	const path = file('markdown'); chat('markdown-chat', path);
	db.insertMessage({ id: 'markdown-link', chatId: 'markdown-chat', role: 'user', parentId: null,
		content: `![Picture](${path})`, createdAt: 2, siblingIndex: 1 });
	db.deleteMessageAndDescendants('markdown-chat-message'); db.sweepAbandonedChatImages(); expect(has(path)).toBe(true);
});

test('reference matching follows the host filesystem case rules', () => {
	const path = file('case'); db.setSetting('attachment-audit-case', JSON.stringify({ path: path.toUpperCase() }));
	db.sweepAbandonedChatImages(); expect(has(path)).toBe(process.platform === 'win32');
});
}
