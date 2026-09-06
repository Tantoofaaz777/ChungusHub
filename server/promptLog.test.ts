/**
 * Prompt debug log persistence: record/patch/snapshot round-trip against the REAL
 * server database (bun:sqlite), plus the cap prune. Mirrors the memory integration
 * test's env dance: CHUNGUS_DATA_DIR is pinned to a throwaway dir before the first
 * db call, so no test can silently point db writes at the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PromptLogEntry } from './promptLog';

let dataDir: string;
let promptLog: typeof import('./promptLog');
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-promptlog-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	promptLog = await import('./promptLog');
	({ serverDb } = await import('./db'));
	// One handle per process, bound on first use (see server/db.ts). Release whatever an
	// earlier file left open so this file's first db call binds to the dir above.
	serverDb.closeForTests();
});

afterAll(() => {
	// Release before deleting: statements against an unlinked file fail for the rest of the run.
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

function entry(id: string, startedAt: number): PromptLogEntry {
	return {
		id,
		source: 'chat',
		kind: 'completion',
		provider: 'openrouter',
		model: 'test/model',
		messages: [{ role: 'user', content: 'hello' }],
		stream: true,
		startedAt,
		status: 'pending'
	};
}

describe('prompt log persistence', () => {
	test('records, patches the result, and survives a snapshot round-trip', () => {
		promptLog.clear();
		promptLog.recordRequest(entry('a', 1000));
		promptLog.recordRequest(entry('b', 2000));

		expect(
			promptLog.patchResult('b', {
				status: 'done',
				endedAt: 2500,
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				finishReason: 'stop',
				responseContent: 'hi there',
				responseThinking: 'pondering'
			})
		).toBe(true);

		const entries = promptLog.snapshot();
		expect(entries.map((e) => e.id)).toEqual(['b', 'a']);
		const b = entries[0];
		expect(b.status).toBe('done');
		expect(b.endedAt).toBe(2500);
		expect(b.usage?.totalTokens).toBe(15);
		expect(b.finishReason).toBe('stop');
		expect(b.responseContent).toBe('hi there');
		expect(b.responseThinking).toBe('pondering');
		expect(entries[1].status).toBe('pending');
	});

	test('patching a request that was never captured reports false', () => {
		expect(promptLog.patchResult('missing', { status: 'done', endedAt: 1 })).toBe(false);
	});

	test('the insert prune drops the oldest rows past the cap', () => {
		promptLog.clear();
		for (let i = 1; i <= 5; i += 1) {
			serverDb.insertPromptLogEntry(`p${i}`, i * 100, JSON.stringify(entry(`p${i}`, i * 100)), 3);
		}
		expect(promptLog.snapshot().map((e) => e.id)).toEqual(['p5', 'p4', 'p3']);
	});

	test('the boot sweep settles requests the previous process never finished', () => {
		promptLog.clear();
		promptLog.recordRequest(entry('live', 1000));
		promptLog.recordRequest(entry('finished', 2000));
		promptLog.patchResult('finished', { status: 'done', endedAt: 2500, finishReason: 'stop' });

		expect(promptLog.settleInterrupted()).toBe(1);

		const byId = new Map(promptLog.snapshot().map((e) => [e.id, e]));
		expect(byId.get('live')?.status).toBe('error');
		expect(byId.get('live')?.error).toContain('server stopped');
		expect(byId.get('live')?.endedAt).toBeGreaterThan(0);
		// A settled entry is untouched, and a second sweep has nothing left to do.
		expect(byId.get('finished')?.status).toBe('done');
		expect(promptLog.settleInterrupted()).toBe(0);
	});

	test('clear wipes everything', () => {
		promptLog.clear();
		expect(promptLog.snapshot()).toEqual([]);
	});
});
