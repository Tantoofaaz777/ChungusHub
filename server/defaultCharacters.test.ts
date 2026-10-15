/**
 * The example characters, against the REAL server database and the REAL `defaults/characters/`
 * folder this build ships.
 *
 * What these protect is the one rule that separates this seed from every other bundled default:
 * it runs once per id and never again, so a character the user deletes stays deleted. A seeder
 * that re-fired would put somebody's deleted character back, or hand them a second copy of one
 * they still have, and both look like data corruption from the library.
 *
 * Same env dance as personaFloor.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir before
 * the first db call, so no test can write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let imagesRoot: string;
let serverDb: any;
let ensureDefaultCharacters: () => void;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-defchar-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	// One handle per process, bound on first use (see server/db.ts). Release whatever an earlier
	// file left open so this file's first db call binds to the dir above.
	serverDb.closeForTests();
	({ ensureDefaultCharacters } = await import('./default-characters'));
	// The database rebinds per file; `IMAGES_ROOT` does not. It is a const frozen when
	// `server/config.ts` was first imported, which in a whole-suite run is whichever file got
	// there first, so the picture checks below ask config where it actually writes rather than
	// assuming the dir pinned above. Don't "fix" this to `dataDir`: it passes alone and fails in
	// the suite.
	imagesRoot = (await import('./config')).IMAGES_ROOT;
});

afterAll(() => {
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

interface Entry {
	id: string;
	type: string;
	identity: { name: string; imageUrl?: string; sprites?: { path: string; label: string }[]; defaultSprite?: string };
	data: { traits: Record<string, string> };
}

function characters(): Entry[] {
	return (serverDb.getAllLibraryEntries() as Entry[]).filter((e) => e.type === 'character');
}

function ledger(): string[] {
	const raw = serverDb.getSetting('seededDefaultCharacters');
	return raw ? (JSON.parse(raw) as string[]) : [];
}

/** The stored file behind a path the row names, so "the row points at bytes on disk" is a claim
 *  these tests actually check rather than assume. */
function storedFile(relativePath: string): string {
	return join(imagesRoot, relativePath.replace(/^images\//, ''));
}

describe('example characters', () => {
	test('a fresh install is given every bundled character, with its art on disk', () => {
		ensureDefaultCharacters();
		const seeded = characters();
		expect(seeded.length).toBeGreaterThan(0);
		expect(ledger()).toContain('lila');

		const lila = seeded.find((e) => e.identity.name === 'Lila');
		expect(lila).toBeDefined();
		// The card's content, not an empty shell: a seeder that wrote the row and dropped the
		// fields would still satisfy a bare row count.
		expect(lila!.data.traits.description.length).toBeGreaterThan(100);
		expect(lila!.data.traits.firstMessage.length).toBeGreaterThan(100);

		expect(lila!.identity.imageUrl).toStartWith('images/characters/');
		expect(existsSync(storedFile(lila!.identity.imageUrl!))).toBe(true);
	});

	test('new installs seed portraits without gallery or sprite data', () => {
		const lila = characters().find((e) => e.identity.name === 'Lila')!;
		expect(lila.identity.sprites).toBeUndefined();
		expect(lila.identity.defaultSprite).toBeUndefined();
		expect((lila.identity as Record<string, unknown>).gallery).toBeUndefined();
	});

	test('booting again seeds nothing: the ledger is what stops a second copy', () => {
		const before = characters().length;
		ensureDefaultCharacters();
		ensureDefaultCharacters();
		expect(characters().length).toBe(before);
	});

	test('a deleted example character does not come back', () => {
		const lila = characters().find((e) => e.identity.name === 'Lila')!;
		// A persona has to exist first: deleting a character is unrelated to the persona floor,
		// but the library refuses to be emptied of personas and this test is about the character.
		serverDb.deleteLibraryEntry(lila.id);
		expect(characters().find((e) => e.identity.name === 'Lila')).toBeUndefined();

		ensureDefaultCharacters();
		expect(characters().find((e) => e.identity.name === 'Lila')).toBeUndefined();
		expect(ledger()).toContain('lila');
	});

	test('a character the reader writes under the same name is left alone', () => {
		// The ledger keys on the BUNDLE ID (the filename in defaults/characters/), never on a
		// display name, and the seeder never reads the library at all. So somebody who deletes
		// the shipped Lila and writes their own is holding an ordinary row that no later boot
		// touches, renames, merges or overwrites.
		const id = crypto.randomUUID();
		const now = Date.now();
		serverDb.insertLibraryEntry({
			id,
			type: 'character',
			identity: { name: 'Lila', tags: [] },
			data: { traits: { description: 'Mine, not the shipped one.', personality: '', background: '' } },
			isFavorite: false,
			createdAt: now,
			updatedAt: now
		});

		ensureDefaultCharacters();

		const named = characters().filter((e) => e.identity.name === 'Lila');
		expect(named.length).toBe(1);
		expect(named[0].id).toBe(id);
		expect(named[0].data.traits.description).toBe('Mine, not the shipped one.');
		// No portrait or sprite pack grafted onto it either.
		expect(named[0].identity.imageUrl).toBeUndefined();
		expect(named[0].identity.sprites).toBeUndefined();
	});

	test('a malformed ledger throws instead of re-seeding everything', () => {
		const before = characters().length;
		serverDb.setSetting('seededDefaultCharacters', '"not-a-list"');
		expect(() => ensureDefaultCharacters()).toThrow();
		// The refusal is the whole point: reading a broken ledger as empty would hand the reader
		// back every example character they had deleted. Nothing was written.
		expect(characters().length).toBe(before);
	});
});
