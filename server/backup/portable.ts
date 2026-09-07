/**
 * Portable backup archives.
 *
 * The live backup store stays as browsable, hardlinked directories. ZIP is only the
 * travelling shape: exports are assembled on disk and downloads stream that file, while
 * imports are staged behind the same `.building` marker as a native snapshot. Nothing here
 * buffers a library-sized archive in memory.
 */
import { Database } from 'bun:sqlite';
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statfsSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile as ZipWriter } from 'yazl';
import { type Entry, openPromise } from 'yauzl';
import {
	PORTABLE_BACKUP_FORMAT,
	PORTABLE_BACKUP_VERSION,
	type PortableBackupEnvelope,
	type SnapshotManifest,
	type SourceSnapshotKind
} from '../../shared/backups';
import { BASELINE_SCHEMA_VERSION } from '../db';
import { ensurePrivacyMarkers } from '../privacy-notice';
import { summarize } from './inventory';
import { type SnapshotIndex, readManifest, writeIndex, writeManifest } from './manifest';
import {
	BUILDING_MARKER,
	SNAPSHOT_DATA_DIR,
	snapshotDataPath,
	snapshotPath,
	uniqueSnapshotId
} from './paths';

const BACKUP_META = 'backup.json';
const DB_ENTRY = `${SNAPSHOT_DATA_DIR}/chungushub.db`;
const TEMP_EXPORT = /^\.portable-export-[0-9a-f-]+\.zip$/i;
const TEMP_IMPORT = /^\.portable-import-[0-9a-f-]+\.zip$/i;
const DOWNLOAD_TTL_MS = 10 * 60_000;
const DISK_RESERVE = 512 * 1024 * 1024;
const MAX_ENTRIES = 250_000;
const MAX_PATH_LENGTH = 512;
const MAX_META_BYTES = 1024 * 1024;
const COMPRESSED_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const SOURCE_KINDS = new Set<SourceSnapshotKind>(['manual', 'scheduled', 'preUpgrade', 'preRestore']);

export interface PortableProgress {
	phase: string;
	filesDone: number;
	filesTotal: number;
}

export interface PreparedExport {
	token: string;
	filename: string;
}

interface PreparedFile extends PreparedExport {
	path: string;
	expires: ReturnType<typeof setTimeout>;
}

export interface DownloadFile {
	filename: string;
	size: number;
	body: ReadableStream<Uint8Array>;
}

const prepared = new Map<string, PreparedFile>();

function availableBytes(path: string): number {
	const info = statfsSync(path);
	return info.bavail * info.bsize;
}

async function walkFiles(root: string, base = root): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const entry of entries) {
		const abs = join(root, entry.name);
		if (entry.isDirectory()) out.push(...(await walkFiles(abs, base)));
		else if (entry.isFile()) out.push(relative(base, abs).split(sep).join('/'));
		else throw new Error(`The snapshot contains an unsupported file: ${relative(base, abs)}.`);
	}
	return out;
}

function sourceKind(manifest: SnapshotManifest): SourceSnapshotKind {
	if (manifest.kind === 'imported') return manifest.sourceKind ?? 'manual';
	return manifest.kind;
}

function downloadName(id: string): string {
	return `ChungusHub-${id}.chungushub-backup.zip`;
}

/** Assemble a portable ZIP without changing the stored snapshot. */
export async function preparePortableExport(
	id: string,
	onProgress?: (progress: PortableProgress) => void
): Promise<PreparedExport> {
	const manifest = readManifest(id);
	if (!manifest) throw new Error(`No readable snapshot named "${id}".`);
	const dataRoot = snapshotDataPath(id);
	if (!existsSync(dataRoot)) throw new Error(`Snapshot "${id}" has no data folder.`);

	const backupRoot = dirname(snapshotPath(id));
	mkdirSync(backupRoot, { recursive: true });
	const files = await walkFiles(dataRoot);
	const estimated = files.reduce((sum, rel) => sum + statSync(join(dataRoot, rel)).size, 0);
	if (estimated + DISK_RESERVE > availableBytes(backupRoot)) {
		throw new Error('There is not enough free disk space to prepare this backup for download.');
	}

	const token = crypto.randomUUID();
	const temp = join(backupRoot, `.portable-export-${token}.zip`);
	const zip = new ZipWriter();
	const envelope: PortableBackupEnvelope = {
		format: PORTABLE_BACKUP_FORMAT,
		formatVersion: PORTABLE_BACKUP_VERSION,
		exportedAt: Date.now(),
		snapshot: manifest
	};
	zip.addBuffer(Buffer.from(JSON.stringify(envelope, null, 2)), BACKUP_META, { compress: true });
	for (const rel of files) {
		const compress = !COMPRESSED_IMAGE.has(extname(rel).toLowerCase());
		zip.addFile(join(dataRoot, rel), `${SNAPSHOT_DATA_DIR}/${rel}`, {
			compress,
			...(compress ? { compressionLevel: 6 } : {})
		});
	}

	onProgress?.({ phase: 'Preparing download', filesDone: 0, filesTotal: files.length });
	try {
		const writing = pipeline(zip.outputStream as Readable, createWriteStream(temp, { flags: 'wx' }));
		zip.end();
		await writing;
	} catch (error) {
		rmSync(temp, { force: true });
		throw error;
	}
	onProgress?.({ phase: 'Ready to download', filesDone: files.length, filesTotal: files.length });

	const filename = downloadName(id);
	const expires = setTimeout(() => {
		const item = prepared.get(token);
		if (!item) return;
		prepared.delete(token);
		rmSync(item.path, { force: true });
	}, DOWNLOAD_TTL_MS);
	expires.unref?.();
	prepared.set(token, { token, filename, path: temp, expires });
	return { token, filename };
}

/** Consume a prepared token once. The generator owns deletion, including on cancellation. */
export function takePreparedExport(token: string): DownloadFile | null {
	const item = prepared.get(token);
	if (!item) return null;
	const chosen = item;
	prepared.delete(token);
	clearTimeout(chosen.expires);
	if (!existsSync(chosen.path)) return null;
	const size = statSync(chosen.path).size;
	const source = createReadStream(chosen.path);
	async function* chunks(): AsyncGenerator<Uint8Array> {
		try {
			for await (const chunk of source) yield chunk as Buffer;
		} finally {
			source.destroy();
			rmSync(chosen.path, { force: true });
		}
	}
	return {
		filename: chosen.filename,
		size,
		body: Readable.toWeb(Readable.from(chunks())) as ReadableStream<Uint8Array>
	};
}

/** Remove archives a process died while preparing or receiving. */
export function sweepPortableTemps(): number {
	const root = dirname(snapshotPath('placeholder'));
	if (!existsSync(root)) return 0;
	let removed = 0;
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isFile() || (!TEMP_EXPORT.test(entry.name) && !TEMP_IMPORT.test(entry.name))) continue;
		rmSync(join(root, entry.name), { force: true });
		removed++;
	}
	return removed;
}

function allowedArchivePath(name: string): boolean {
	if (name === BACKUP_META || name === DB_ENTRY) return true;
	return name.startsWith(`${SNAPSHOT_DATA_DIR}/images/`) || name.startsWith(`${SNAPSHOT_DATA_DIR}/presets/`);
}

function allowedArchiveDirectory(name: string): boolean {
	return (
		name === `${SNAPSHOT_DATA_DIR}/` ||
		name === `${SNAPSHOT_DATA_DIR}/images/` ||
		name === `${SNAPSHOT_DATA_DIR}/presets/` ||
		name.startsWith(`${SNAPSHOT_DATA_DIR}/images/`) ||
		name.startsWith(`${SNAPSHOT_DATA_DIR}/presets/`)
	);
}

function isDirectory(entry: Entry): boolean {
	return entry.fileName.endsWith('/');
}

function isSymlink(entry: Entry): boolean {
	const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
	return (mode & 0o170000) === 0o120000;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	CRC_TABLE[n] = c >>> 0;
}

function crcMeter(expected: number): Transform {
	let crc = 0xffffffff;
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
			callback(null, chunk);
		},
		flush(callback) {
			const actual = (crc ^ 0xffffffff) >>> 0;
			callback(actual === (expected >>> 0) ? null : new Error('A file in the backup failed its checksum.'));
		}
	});
}

async function readSmallEntry(zip: Awaited<ReturnType<typeof openPromise>>, entry: Entry): Promise<Buffer> {
	if (entry.uncompressedSize > MAX_META_BYTES) throw new Error('The backup metadata is too large.');
	const parts: Buffer[] = [];
	const meter = crcMeter(entry.crc32);
	meter.on('data', (chunk: Buffer) => parts.push(Buffer.from(chunk)));
	await pipeline(await zip.openReadStreamPromise(entry), meter);
	return Buffer.concat(parts);
}

function parseEnvelope(raw: Buffer): PortableBackupEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw.toString('utf8'));
	} catch {
		throw new Error('This file does not contain readable ChungusHub backup metadata.');
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('This is not a ChungusHub backup archive.');
	}
	const envelope = value as Partial<PortableBackupEnvelope>;
	if (envelope.format !== PORTABLE_BACKUP_FORMAT) throw new Error('This is not a ChungusHub backup archive.');
	if (envelope.formatVersion !== PORTABLE_BACKUP_VERSION) {
		throw new Error(`This backup uses unsupported portable format ${String(envelope.formatVersion)}.`);
	}
	const snapshot = envelope.snapshot as SnapshotManifest | undefined;
	if (!snapshot || typeof snapshot !== 'object') throw new Error('The backup metadata has no snapshot.');
	if (!Number.isFinite(snapshot.createdAt) || snapshot.createdAt <= 0 || snapshot.createdAt > 8.64e15) {
		throw new Error('The backup metadata has an invalid creation date.');
	}
	if (!Number.isFinite(snapshot.schemaVersion) || snapshot.schemaVersion < 0) {
		throw new Error('The backup metadata has an invalid database format.');
	}
	if (snapshot.kind !== 'imported' && !SOURCE_KINDS.has(snapshot.kind)) {
		throw new Error('The backup metadata has an unknown snapshot type.');
	}
	if (snapshot.kind === 'imported' && snapshot.sourceKind && !SOURCE_KINDS.has(snapshot.sourceKind)) {
		throw new Error('The backup metadata has an unknown source snapshot type.');
	}
	return envelope as PortableBackupEnvelope;
}

function countPortableFiles(files: string[]): { images: number; presets: number } {
	return {
		images: files.filter((name) => name.startsWith('images/') && !name.includes('/thumbnails/')).length,
		presets: files.filter((name) => /^presets\/[^/]+\.json$/.test(name)).length
	};
}

/** Receive, validate and commit one portable archive as an imported snapshot. */
export async function importPortableBackup(
	body: ReadableStream<Uint8Array> | null,
	onProgress?: (progress: PortableProgress) => void
): Promise<SnapshotManifest> {
	if (!body) throw new Error('Choose a ChungusHub backup ZIP to import.');
	const backupRoot = dirname(snapshotPath('placeholder'));
	mkdirSync(backupRoot, { recursive: true });
	ensurePrivacyMarkers(backupRoot, 'backups');
	const uploadId = crypto.randomUUID();
	const upload = join(backupRoot, `.portable-import-${uploadId}.zip`);
	const freeAtStart = availableBytes(backupRoot);
	let uploaded = 0;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			uploaded += chunk.length;
			callback(
				uploaded + DISK_RESERVE <= freeAtStart
					? null
					: new Error('There is not enough free disk space to receive this backup.'),
				chunk
			);
		}
	});

	onProgress?.({ phase: 'Receiving backup', filesDone: 0, filesTotal: 0 });
	let outDir: string | null = null;
	try {
		await pipeline(Readable.fromWeb(body), meter, createWriteStream(upload, { flags: 'wx' }));
		const zip = await openPromise(upload, {
			autoClose: false,
			lazyEntries: true,
			decodeStrings: true,
			validateEntrySizes: true,
			strictFileNames: true
		});
		try {
			if (zip.entryCount > MAX_ENTRIES) throw new Error('This backup contains too many files.');
			const entries: Entry[] = [];
			const names = new Set<string>();
			let expanded = 0;
			let metaEntry: Entry | null = null;
			for await (const entry of zip.eachEntry()) {
				const name = entry.fileName;
				if (name.length > MAX_PATH_LENGTH) throw new Error('A path in this backup is too long.');
				if (names.has(name)) throw new Error(`The backup contains the path "${name}" more than once.`);
				names.add(name);
				if (entry.isEncrypted()) throw new Error('Encrypted ZIP entries are not supported.');
				if (!entry.canDecodeFileData() || (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)) {
					throw new Error('The backup uses an unsupported ZIP compression method.');
				}
				if (isSymlink(entry)) throw new Error('Backup archives may not contain symbolic links.');
				if (isDirectory(entry)) {
					if (!allowedArchiveDirectory(name)) {
						throw new Error(`The backup contains an unexpected folder: ${name}`);
					}
					continue;
				}
				if (!allowedArchivePath(name)) throw new Error(`The backup contains an unexpected file: ${name}`);
				expanded += entry.uncompressedSize;
				entries.push(entry);
				if (name === BACKUP_META) metaEntry = entry;
			}
			if (!metaEntry) throw new Error('This ZIP has no ChungusHub backup metadata.');
			if (!names.has(DB_ENTRY)) throw new Error('This backup does not contain its database.');
			if (expanded + DISK_RESERVE > availableBytes(backupRoot)) {
				throw new Error('There is not enough free disk space to unpack this backup.');
			}

			const envelope = parseEnvelope(await readSmallEntry(zip, metaEntry));
			const original = envelope.snapshot;
			const id = uniqueSnapshotId(new Date(original.createdAt), 'imported');
			outDir = snapshotPath(id);
			const dataDir = join(outDir, SNAPSHOT_DATA_DIR);
			mkdirSync(dataDir, { recursive: true });
			writeFileSync(join(outDir, BUILDING_MARKER), `${Date.now()}\n`);

			const dataEntries = entries.filter((entry) => entry.fileName !== BACKUP_META);
			onProgress?.({ phase: 'Unpacking backup', filesDone: 0, filesTotal: dataEntries.length });
			let done = 0;
			for (const entry of dataEntries) {
				const destination = join(outDir, ...entry.fileName.split('/'));
				await mkdir(dirname(destination), { recursive: true });
				await pipeline(
					await zip.openReadStreamPromise(entry),
					crcMeter(entry.crc32),
					createWriteStream(destination, { flags: 'wx' })
				);
				done++;
				if (done % 250 === 0 || done === dataEntries.length) {
					onProgress?.({ phase: 'Unpacking backup', filesDone: done, filesTotal: dataEntries.length });
				}
			}

			onProgress?.({ phase: 'Checking backup', filesDone: done, filesTotal: dataEntries.length });
			const dbPath = join(dataDir, 'chungushub.db');
			const files = await walkFiles(dataDir);
			for (const rel of files.filter((name) => name.startsWith('presets/') && name.endsWith('.json'))) {
				try {
					JSON.parse(await Bun.file(join(dataDir, rel)).text());
				} catch {
					throw new Error(`The backup contains an unreadable preset: ${rel}.`);
				}
			}

			const db = new Database(dbPath, { readonly: true });
			let schemaVersion = 0;
			let summary;
			try {
				const integrity = db.query('PRAGMA integrity_check').all() as Record<string, unknown>[];
				if (integrity.length !== 1 || !Object.values(integrity[0] ?? {}).includes('ok')) {
					throw new Error('The database in this backup is damaged.');
				}
				try {
					const row = db.query('SELECT MAX(version) AS v FROM _migrations').get() as {
						v: number | null;
					} | null;
					schemaVersion = row?.v ?? 0;
				} catch {
					throw new Error('This backup does not contain a recognized ChungusHub database.');
				}
				if (schemaVersion < BASELINE_SCHEMA_VERSION) {
					throw new Error('This backup is older than the database formats this ChungusHub can restore.');
				}
				const counts = countPortableFiles(files);
				summary = summarize(db, counts.images, counts.presets);
			} finally {
				db.close();
			}

			let logical = 0;
			const index: SnapshotIndex = {};
			for (const rel of files) logical += (await stat(join(dataDir, rel))).size;
			const imported: SnapshotManifest = {
				id,
				createdAt: original.createdAt,
				kind: 'imported',
				sourceKind: sourceKind(original),
				label:
					typeof original.label === 'string' && original.label.trim()
						? original.label.trim().slice(0, 60)
						: null,
				pinned: false,
				appVersion:
					typeof original.appVersion === 'string' ? original.appVersion.slice(0, 100) : 'unknown',
				schemaVersion,
				summary,
				bytes: { logical, onDisk: logical },
				fileCount: files.length,
				linked: false,
				warnings: Array.isArray(original.warnings)
					? original.warnings
							.filter((warning): warning is string => typeof warning === 'string')
							.slice(0, 100)
							.map((warning) => warning.slice(0, 1000))
					: []
			};
			writeIndex(outDir, index);
			writeManifest(outDir, imported);
			rmSync(join(outDir, BUILDING_MARKER), { force: true });
			outDir = null;
			return imported;
		} finally {
			zip.close();
		}
	} catch (error) {
		if (outDir) rmSync(outDir, { recursive: true, force: true });
		throw error;
	} finally {
		rmSync(upload, { force: true });
	}
}
