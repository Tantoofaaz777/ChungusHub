/**
 * The repairs a freshly opened database needs before anything is allowed to read it.
 *
 * They run at every boot, and that single call covers the boot that follows a restore too:
 * a restored database was written by a process that is long gone, so a logged prompt may
 * still be shown in flight with nothing left alive to settle it.
 */
import { serverDb } from './db';
import * as promptLog from './promptLog';
import { ensureDefaultPresets } from './files';
import { ensureDefaultCharacters } from './default-characters';

export function runBootSweeps(): void {
	// Same reasoning for the debug log: a captured request whose result never arrived stays
	// 'pending' on disk, and the panel would show it as in-flight forever, indistinguishable
	// from one that is genuinely still running.
	const settledPrompts = promptLog.settleInterrupted();
	if (settledPrompts > 0) {
		console.log(`[debug] ${settledPrompts} logged prompt(s) never returned; settled as errors.`);
	}
	// Reap chat-image uploads that never got a referencing row (abandoned composers):
	// nothing else can ever reach them. Age-guarded inside.
	serverDb.sweepAbandonedChatImages();
	// Also reseeds after a restore: a snapshot can predate a preset this build ships.
	ensureDefaultPresets();
	// The example characters, which are the opposite: seeded once per id and never again, so a
	// deleted one stays deleted (server/default-characters.ts).
	ensureDefaultCharacters();
}
