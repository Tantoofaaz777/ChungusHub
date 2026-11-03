import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { removeDatabaseFixture } from './test-fixtures';
import { captureScene, resolveScenes } from '../shared/memory-scenes';
import { threadsOnPath } from '../shared/threads/model';
import type { ContinuationContext, ConversationPlacement } from '../shared/conversation';

let db: typeof import('./db').serverDb;
let dir: string;
let referencedImagePaths: typeof import('./image-references').referencedImagePaths;
const previous = process.env.CHUNGUS_DATA_DIR;
beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'chungus-conversation-'));
	process.env.CHUNGUS_DATA_DIR = dir;
	({ serverDb: db } = await import('./db')); db.closeForTests();
	({ referencedImagePaths } = await import('./image-references'));
});
afterAll(() => {
	db.closeForTests();
	if (previous === undefined) delete process.env.CHUNGUS_DATA_DIR; else process.env.CHUNGUS_DATA_DIR = previous;
	removeDatabaseFixture(dir, 'chungus-conversation-');
});
const rows = (chatId: string) => db.getMessagesByChat(chatId) as any[];
function chat(modern = true) {
	const id = crypto.randomUUID();
	db.insertChat({ id, title: 'Story', createdAt: 1, updatedAt: 2, rootMessageId: null, activeLeafId: null,
		settings: { temperature: 0.7 }, featureState: '{"authorsNote":{"text":"Remember"}}', conversationVersion: modern ? 2 : 1 });
	return id;
}
function append(chatId: string, content: string, role = 'user') {
	const context = db.getConversationPlacement(chatId, 'append')!;
	const id = crypto.randomUUID();
	db.appendConversationTurn({ id, chatId, content, role, parentId: context.expectedLeafId, createdAt: Date.now() }, context);
	return id;
}
function generate(chatId: string, operation: ConversationPlacement['operation'], content = 'Generated', placement = db.getConversationPlacement(chatId, operation)!, finishReason = 'stop') {
	return db.commitGeneratedTurn({ chatId, parentId: placement.expectedLeafId, expectedLeafId: placement.expectedLeafId,
		claimsRoot: placement.expectedLeafId === null, content, thinking: 'Thought', model: 'model', provider: 'test',
		tokensPrompt: 3, tokensCompletion: 4, finishReason, generationMs: 10, firstTokenMs: 1,
		reasoningMs: 2, lorebook: { entries: [] }, spendSteeringIds: [], placement });
}
function continuationContext(chatId: string): ContinuationContext {
	const target = rows(chatId).at(-1)!;
	return { chatId, messageId: target.id, variantId: target.selectedVariantId, expectedRevision: target.revision,
		contextFingerprint: db.getConversationPlacement(chatId, 'append')!.contextFingerprint };
}
const continuationPatch = { content: 'Reply continued', thinking: 'Continued reasoning', tokensPrompt: 1,
	tokensCompletion: 2, finishReason: 'stop', generationMs: 10, reasoningMs: null };

describe('turn and variant persistence', () => {
	test('greetings and generated swipes share a stable turn, endpoint and position', () => {
		const id = chat();
		const opening = db.seedConversationGreetings(id, ['First', 'Second'])!;
		expect(rows(id)).toHaveLength(1);
		expect(rows(id)[0].variants.map((v: any) => v.content)).toEqual(['First', 'Second']);
		generate(id, 'add_variant', 'Third');
		const turn = rows(id)[0];
		expect(turn.id).toBe(opening); expect(turn.position).toBe(0);
		expect(turn.variants.map((v: any) => v.content)).toEqual(['First', 'Second', 'Third']);
		expect((db.getChat(id) as any).activeLeafId).toBe(opening);
		db.selectMessageVariant({ chatId: id, messageId: opening, variantId: turn.variants[0].id, expectedRevision: turn.revision });
		expect(rows(id)[0].content).toBe('First');
		expect(rows(id)[0].id).toBe(opening);
	});

	test('selection checks ownership and revisions and old turns cannot be swiped', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const old = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: old.id, variantId: old.variants[1].id, expectedRevision: old.revision });
		expect(() => db.selectMessageVariant({ chatId: id, messageId: old.id, variantId: old.variants[0].id, expectedRevision: old.revision })).toThrow('changed');
		const other = chat(); db.seedConversationGreetings(other, ['Other']);
		const current = rows(id)[0];
		expect(() => db.selectMessageVariant({ chatId: id, messageId: current.id, variantId: rows(other)[0].selectedVariantId, expectedRevision: current.revision })).toThrow('another turn');
		append(id, 'Continue');
		expect(() => db.selectMessageVariant({ chatId: id, messageId: current.id, variantId: current.variants[0].id, expectedRevision: current.revision })).toThrow();
	});

	test('append refuses a context whose selected variant changed during review', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const context = db.getConversationPlacement(id, 'append')!;
		const turn = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision });
		expect(() => db.appendConversationTurn({ id: crypto.randomUUID(), chatId: id, parentId: turn.id, role: 'user', content: 'Stale', createdAt: 1 }, context)).toThrow('changed');
		expect(rows(id)).toHaveLength(1);
	});

	test('a completed swipe can be saved unselected after another device selects a version', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const context = db.getConversationPlacement(id, 'add_variant')!;
		const turn = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision });
		generate(id, 'add_variant', 'Landed later', context);
		expect(rows(id)[0].content).toBe('B');
		expect(rows(id)[0].variants.map((v: any) => v.content)).toContain('Landed later');
	});

	test('selecting away and back still counts as a newer deliberate selection', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const context = db.getConversationPlacement(id, 'add_variant')!;
		let turn = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision });
		turn = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[0].id, expectedRevision: turn.revision });
		generate(id, 'add_variant', 'Delayed', context);
		expect(rows(id)[0].content).toBe('A');
		expect(rows(id)[0].variants).toHaveLength(3);
	});

	test('replacement swaps versions only, and deleting a version never deletes the turn', () => {
		const id = chat(); append(id, 'Question'); generate(id, 'append', 'First'); generate(id, 'add_variant', 'Second');
		const before = rows(id);
		generate(id, 'replace_variants', 'Replacement');
		const after = rows(id);
		expect(after.map(m => m.id)).toEqual(before.map(m => m.id));
		expect(after[1].variants.map((v: any) => v.content)).toEqual(['Replacement']);
		generate(id, 'add_variant', 'Extra');
		const latest = rows(id)[1];
		db.deleteMessageVariant({ chatId: id, messageId: latest.id, variantId: latest.selectedVariantId, expectedRevision: latest.revision });
		expect(rows(id)[1].content).toBe('Replacement');
		const only = rows(id)[1];
		expect(() => db.deleteMessageVariant({ chatId: id, messageId: only.id, variantId: only.selectedVariantId, expectedRevision: only.revision })).toThrow('last variant');
	});

	test('a stale replacement preserves versions and durably recovers its generated output', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const placement = db.getConversationPlacement(id, 'replace_variants')!;
		const turn = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision });
		expect(() => generate(id, 'replace_variants', 'Recover me', placement)).toThrow('recovery');
		expect(rows(id)[0].variants).toHaveLength(2);
		expect((db.getRecoveredGenerations(id)[0] as any).payload.content).toBe('Recover me');
	});

	test('stopping a new swipe keeps its partial text; stopping a replacement preserves all old versions', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Original']);
		generate(id, 'add_variant', 'Partial', db.getConversationPlacement(id, 'add_variant')!, 'cancelled');
		expect(rows(id)[0].variants.map((v: any) => v.content)).toEqual(['Original', 'Partial']);
		const before = rows(id);
		expect(generate(id, 'replace_variants', 'Stopped', db.getConversationPlacement(id, 'replace_variants')!, 'cancelled')).toBeNull();
		expect(rows(id)).toEqual(before);
		expect(generate(id, 'replace_variants', '')).toBeNull();
	});

	test('a changed endpoint cannot receive an old swipe generation', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A']);
		const placement = db.getConversationPlacement(id, 'add_variant')!;
		append(id, 'Moved on');
		expect(() => generate(id, 'add_variant', 'Old context', placement)).toThrow('recovery');
		expect(rows(id)[0].variants).toHaveLength(1);
		expect(rows(id)[1].content).toBe('Moved on');
	});

	test('branch copies selected prefix while duplicate copies every version with independent references', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0];
		const branch = db.branchChat({ chatId: id, messageId: turn.id, content: 'B', variantId: turn.variants[1].id, title: 'Branch' });
		expect(rows(branch)[0].content).toBe('B'); expect(rows(branch)[0].variants).toHaveLength(1);
		expect(rows(id)[0].content).toBe('A');
		const duplicate = db.duplicateChat({ chatId: id, title: 'Duplicate', includeMemory: true });
		expect(rows(duplicate)[0].variants.map((v: any) => v.content)).toEqual(['A', 'B']);
		expect(rows(duplicate)[0].variants.every((v: any) => !turn.variants.some((old: any) => old.id === v.id))).toBe(true);
	});

	test('memory and Threads sources include exact variant identity, even for identical text', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Same', 'Same']);
		const turn = rows(id)[0];
		const scene = db.saveMemoryScene({ chatId: id, title: 'Memory', content: 'Summary', source: captureScene([turn]) });
		const path = [{ ...turn, selectedVariantId: turn.variants[1].id }];
		expect(resolveScenes([scene], path)[0].status).toBe('other-version');
		expect(() => db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision })).toThrow('memory');
		const feed = { title: 'Reactions', post: { username: 'reader', body: 'Post', score: 1 }, comments: [] };
		const round = db.saveThreadsRound({ id: crypto.randomUUID(), chatId: id, label: 'Thread', feed,
			messages: [{ id: turn.id, variantId: turn.selectedVariantId, index: 0, role: 'assistant', content: 'Same', speaker: 'Narrator' }] });
		expect(threadsOnPath([round], path)).toEqual([]);
	});

	test('variant edits propagate through the selected projection and sync deltas', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0], before = db.getMessagesDelta(id, null) as any;
		db.updateMessageContent(turn.id, 'Edited'); db.setMessageBookmarked(turn.id, true);
		const after = rows(id)[0], delta = db.getMessagesDelta(id, before.rev) as any;
		expect(after.variants[0].content).toBe('Edited'); expect(after.variants[0].isBookmarked).toBe(true);
		expect(after.variants[1].content).toBe('B'); expect(after.variants[1].isBookmarked).toBe(false);
		expect(delta.upserts[0].variants[0].content).toBe('Edited');
	});

	test('bookmarks address an exact version, publish its delta and leave selected context unchanged', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0], before = db.getMessagesDelta(id, null) as any;
		const context = db.getConversationPlacement(id, 'append')!;
		db.setMessageVariantBookmarked({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision, bookmarked: true });
		const after = rows(id)[0], delta = db.getMessagesDelta(id, before.rev) as any;
		expect(after.content).toBe('A'); expect(after.selectedVariantId).toBe(turn.selectedVariantId);
		expect(after.isBookmarked).toBe(false); expect(after.variants[1].isBookmarked).toBe(true);
		expect(delta.upserts[0].variants[1].isBookmarked).toBe(true);
		expect(db.getConversationPlacement(id, 'append')!.contextFingerprint).toBe(context.contextFingerprint);
		expect(() => db.setMessageVariantBookmarked({ chatId: id, messageId: turn.id, variantId: turn.variants[0].id, expectedRevision: turn.revision, bookmarked: true })).toThrow('changed');
	});

	test('an editor cannot overwrite the response selected after the editor opened', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const opened = rows(id)[0];
		db.selectMessageVariant({ chatId: id, messageId: opened.id, variantId: opened.variants[1].id, expectedRevision: opened.revision });
		expect(() => db.updateMessageVariantContent({ chatId: id, messageId: opened.id, variantId: opened.selectedVariantId, expectedRevision: opened.revision, content: 'Stale edit' })).toThrow('changed');
		const current = rows(id)[0];
		db.updateMessageVariantContent({ chatId: id, messageId: current.id, variantId: opened.selectedVariantId, expectedRevision: current.revision, content: 'Edit A only', minor: true });
		const after = rows(id)[0];
		expect(after.content).toBe('B'); expect(after.variants[0].content).toBe('Edit A only');
		expect(after.variants[0].minorEditedAt).toBeGreaterThan(0);
		expect(after.variants[1].content).toBe('B');
		const other = chat(); db.seedConversationGreetings(other, ['Foreign']);
		expect(() => db.updateMessageVariantContent({ chatId: other, messageId: after.id, variantId: after.selectedVariantId, expectedRevision: after.revision, content: 'Foreign' })).toThrow('no longer available');
		expect(() => db.setMessageVariantBookmarked({ chatId: id, messageId: after.id, variantId: rows(other)[0].selectedVariantId, expectedRevision: after.revision, bookmarked: true })).toThrow('no longer available');
		expect(rows(id)[0]).toEqual(after);
	});

	test('bookmark metadata does not invalidate a prepared send or an in-flight append', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const prepared = db.getConversationPlacement(id, 'append')!;
		let turn = rows(id)[0];
		db.setMessageVariantBookmarked({ chatId: id, messageId: turn.id, variantId: turn.selectedVariantId, expectedRevision: turn.revision, bookmarked: true });
		db.validateConversationGeneration(id, prepared);
		const userId = crypto.randomUUID();
		db.appendConversationTurn({ id: userId, chatId: id, parentId: turn.id, role: 'user', content: 'Next', createdAt: 1 }, prepared);
		const generation = db.getConversationPlacement(id, 'append')!;
		turn = rows(id)[0];
		db.setMessageVariantBookmarked({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision, bookmarked: true });
		generate(id, 'append', 'Reply', generation);
		expect(rows(id).map(m => m.content)).toEqual(['A', 'Next', 'Reply']);
		expect(db.getRecoveredGenerations(id)).toEqual([]);
		const pending = db.getConversationPlacement(id, 'append')!;
		turn = rows(id)[0];
		db.updateMessageVariantContent({ chatId: id, messageId: turn.id, variantId: turn.selectedVariantId, expectedRevision: turn.revision, content: 'Changed context' });
		expect(() => generate(id, 'append', 'Stale context', pending)).toThrow('recovery');
		expect(rows(id)).toHaveLength(3);
	});

	test('chat deletion stats count turns and all saved versions independently', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		append(id, 'Question'); generate(id, 'append', 'Reply'); generate(id, 'add_variant', 'Alternative');
		expect(db.getChatListStats()[id]).toMatchObject({ path: 3, total: 3, versions: 5 });
	});

	test('prompt visibility rejects a stale swipe selection and updates only the exact version', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const before = rows(id)[0];
		const clicked = { chatId: id, messageId: before.id, variantId: before.selectedVariantId, expectedRevision: before.revision };
		db.selectMessageVariant({ ...clicked, variantId: before.variants[1].id });
		expect(() => db.setMessageExcludedFromPrompt(before.id, true, null, clicked)).toThrow('changed');
		expect(rows(id)[0].variants.every((v: any) => !v.excludedFromPrompt)).toBe(true);
		expect(() => db.setMessageExcludedFromPrompt(before.id, true)).toThrow('Reload');
		const current = rows(id)[0];
		const delta = db.setMessageExcludedFromPrompt(current.id, true, current.revision, {
			...clicked, variantId: current.selectedVariantId, expectedRevision: current.revision
		}) as any;
		expect(delta.upserts[0].excludedFromPrompt).toBe(true);
		expect(rows(id)[0].variants.map((v: any) => [v.content, v.excludedFromPrompt])).toEqual([['A', false], ['B', true]]);
		const after = rows(id)[0];
		expect(() => db.setMessageExcludedFromPrompt(after.id, false, null, { ...clicked, expectedRevision: after.revision, chatId: chat() })).toThrow('Reload');
		expect(rows(id)[0]).toEqual(after);
	});

	for (const change of ['content', 'visibility'] as const) test(`continuation rejects an earlier ${change} change before generation and recovers a completed result`, () => {
		const id = chat(); append(id, 'Original question'); generate(id, 'append', 'Reply');
		const expected = continuationContext(id), source = rows(id)[0];
		db.validateMessageContinuation(expected);
		if (change === 'content') db.updateMessageVariantContent({ chatId: id, messageId: source.id, variantId: source.selectedVariantId, expectedRevision: source.revision, content: 'Changed question' });
		else db.setMessageExcludedFromPrompt(source.id, true, null, { chatId: id, messageId: source.id, variantId: source.selectedVariantId, expectedRevision: source.revision });
		expect(rows(id).at(-1)!.revision).toBe(expected.expectedRevision);
		expect(() => db.validateMessageContinuation(expected)).toThrow('context changed');
		expect(() => db.applyMessageContinuation(expected.messageId, continuationPatch, expected)).toThrow('recovery');
		expect(rows(id).at(-1)!.content).toBe('Reply');
		expect(db.getRecoveredGenerations(id)[0].payload).toMatchObject({ patch: continuationPatch, expected });
	});

	test('continuation with unchanged context succeeds despite a bookmark on an earlier turn', () => {
		const id = chat(); append(id, 'Question'); generate(id, 'append', 'Reply');
		const expected = continuationContext(id), source = rows(id)[0];
		db.setMessageVariantBookmarked({ chatId: id, messageId: source.id, variantId: source.selectedVariantId, expectedRevision: source.revision, bookmarked: true });
		db.validateMessageContinuation(expected);
		db.applyMessageContinuation(expected.messageId, continuationPatch, expected);
		expect(rows(id).at(-1)!.content).toBe(continuationPatch.content);
		expect(db.getRecoveredGenerations(id)).toEqual([]);
	});

	test('continuation rejects a moved endpoint or missing context and preserves completed output', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Reply']);
		const expected = continuationContext(id);
		append(id, 'Moved on');
		expect(() => db.validateMessageContinuation(expected)).toThrow('context changed');
		expect(() => db.applyMessageContinuation(expected.messageId, continuationPatch, expected)).toThrow('recovery');
		expect(() => db.applyMessageContinuation(expected.messageId, continuationPatch)).toThrow('recovery');
		expect(rows(id).map(m => m.content)).toEqual(['Reply', 'Moved on']);
		expect(db.getRecoveredGenerations(id)).toHaveLength(2);
	});

	test('server-owned continuation joins once, accumulates timings and spends steering with the write', () => {
		const id = chat(); append(id, 'Question'); generate(id, 'append', 'Reply');
		const before = rows(id).at(-1)!, context = continuationContext(id), base = db.captureMessageContinuation(context);
		const note = crypto.randomUUID();
		db.insertSteeringNote({ id: note, scope: 'chat', scopeId: id, title: null, text: 'Guidance', enabled: true, mode: 'once', depth: null, role: null, createdAt: 1, updatedAt: 1 });
		const commit = { ...context, continuationSent: 'Reply', spendSteeringIds: [note] };
		const landed = db.commitMessageContinuation(commit, base, continuationPatch);
		const after = rows(id).at(-1)!;
		expect(landed).toEqual({ messageId: before.id, spentSteeringIds: [note] });
		expect(after.content).toBe('Reply continued'); expect(after.thinking).toBe('Thought\n\nContinued reasoning');
		expect(after.tokensCompletion).toBe(6); expect(after.generationMs).toBe(20); expect(after.reasoningMs).toBe(2);
		expect(after.firstTokenMs).toBe(before.firstTokenMs); expect(after.editedAt).toBe(before.editedAt);
		expect(after.variants).toHaveLength(1); expect((db.getChat(id) as any).activeLeafId).toBe(before.id);
		expect((db.getAllSteeringNotes().find((n: any) => n.id === note) as any).enabled).toBe(false);
	});

	test('server-owned continuation recovers its captured base after a remote edit, without spending notes', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Original']);
		const context = continuationContext(id), base = db.captureMessageContinuation(context), note = crypto.randomUUID();
		db.insertSteeringNote({ id: note, scope: 'chat', scopeId: id, text: 'Guidance', enabled: true, mode: 'once', createdAt: 1, updatedAt: 1 });
		db.updateMessageVariantContent({ ...context, content: 'Remote edit' });
		expect(() => db.commitMessageContinuation({ ...context, continuationSent: 'Original', spendSteeringIds: [note] }, base,
			{ ...continuationPatch, content: 'More text' })).toThrow('recovery');
		expect(rows(id)[0].content).toBe('Remote edit');
		expect(db.getRecoveredGenerations(id)[0].payload).toMatchObject({ patch: { content: 'Original More text' } });
		expect(db.getAllSteeringNotes().some((n: any) => n.id === note)).toBe(true);
	});

	test('empty and fully restated continuations leave text, activity and steering untouched', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Original']);
		const context = { ...continuationContext(id), continuationSent: 'Original', spendSteeringIds: [] };
		const base = db.captureMessageContinuation(context), before = rows(id), activity = (db.getChat(id) as any).updatedAt;
		for (const content of ['', '  ', 'Original']) expect(db.commitMessageContinuation(context, base, { ...continuationPatch, content })).toBeNull();
		expect(rows(id)).toEqual(before); expect((db.getChat(id) as any).updatedAt).toBe(activity);
	});

	test('a steering write failure rolls back the continuation too', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Original']);
		const context = { ...continuationContext(id), continuationSent: 'Original', spendSteeringIds: ['note'] };
		const base = db.captureMessageContinuation(context), before = rows(id), original = db.consumeSteeringNotes;
		try {
			db.consumeSteeringNotes = () => { throw new Error('Steering write failed'); };
			expect(() => db.commitMessageContinuation(context, base, continuationPatch)).toThrow('Steering write failed');
		} finally { db.consumeSteeringNotes = original; }
		expect(rows(id)).toEqual(before);
	});

	test('a stale continuation cannot overwrite another selected version and is recovered', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0];
		const expected = continuationContext(id);
		db.selectMessageVariant({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, expectedRevision: turn.revision });
		expect(() => db.applyMessageContinuation(turn.id, { content: 'A continued', thinking: null, tokensPrompt: 1,
			tokensCompletion: 2, finishReason: 'stop', generationMs: 10, reasoningMs: null },
			expected)).toThrow('recovery');
		expect(rows(id)[0].content).toBe('B');
		expect((db.getRecoveredGenerations(id)[0] as any).payload.patch.content).toBe('A continued');
	});

	test('database guards reject foreign selection, deleting a selected version and user swipes', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0], probe = new Database(join(dir, 'chungushub.db'));
		try {
			probe.exec('PRAGMA foreign_keys = ON');
			expect(() => probe.run('UPDATE messages SET selected_variant_id = ? WHERE id = ?', ['foreign', turn.id])).toThrow('belong');
			expect(() => probe.run('DELETE FROM message_variants WHERE id = ?', [turn.selectedVariantId])).toThrow('selected');
			const user = append(id, 'User');
			expect(() => probe.run('INSERT INTO message_variants(id, message_id, ordinal, payload_json) VALUES (?, ?, 1, ?)',
				[crypto.randomUUID(), user, '{"content":"Invalid"}'])).toThrow('assistant');
			db.deleteMessageAndDescendants(turn.id);
			expect(rows(id)).toEqual([]);
			expect(probe.query('SELECT COUNT(*) AS n FROM message_variants WHERE message_id IN (?, ?)').get(turn.id, user)).toEqual({ n: 0 });
		} finally { probe.close(); }
	});

	test('retention clears reasoning in every old version without counting swipes as turns', () => {
		const id = chat(); append(id, 'Question'); generate(id, 'append', 'A'); generate(id, 'add_variant', 'B');
		append(id, 'Next'); generate(id, 'append', 'Recent');
		db.setSetting('generalSettings', JSON.stringify({ autoClearReasoning: true, reasoningDepth: 2 }));
		const turns = rows(id);
		expect(turns[1].variants.every((v: any) => v.thinking === null)).toBe(true);
		expect(turns[3].thinking).toBe('Thought');
		db.setSetting('generalSettings', JSON.stringify({ autoClearReasoning: false, reasoningDepth: 2 }));
	});

	test('inactive version images are included in backup inventories and remain independent of projection', () => {
		const id = chat();
		db.insertMessage({ id: crypto.randomUUID(), chatId: id, parentId: null, role: 'assistant', content: 'Image',
			attachments: [{ kind: 'image', path: 'images/chat/inactive-variant.png' }], createdAt: 1 });
		const first = rows(id)[0];
		db.updateChat({ id, rootMessageId: first.id, activeLeafId: first.id });
		generate(id, 'add_variant', 'No image');
		const probe = new Database(join(dir, 'chungushub.db'));
		try { expect(referencedImagePaths(probe, true).has('images/chat/inactive-variant.png')).toBe(true); }
		finally { probe.close(); }
	});

	test('copied memories bind to the copied variant identities', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const turn = rows(id)[0];
		db.saveMemoryScene({ chatId: id, title: 'Memory', content: 'Summary', source: captureScene([turn]) });
		const duplicate = db.duplicateChat({ chatId: id, title: 'Copy', includeMemory: true });
		expect(db.getMemoryScenes(duplicate)[0].source[0].variantId).toBe(rows(duplicate)[0].selectedVariantId);
		expect(resolveScenes(db.getMemoryScenes(duplicate), rows(duplicate))[0].status).toBe('active');
		const branch = db.branchChat({ chatId: id, messageId: turn.id, variantId: turn.variants[1].id, content: 'B', title: 'Other version' });
		expect(db.getMemoryScenes(branch)).toEqual([]);
	});

	test('a SQLite snapshot round trip preserves selected and inactive versions and ownership', () => {
		const id = chat(); db.seedConversationGreetings(id, ['Selected', 'Inactive']);
		const source = rows(id), probe = new Database(join(dir, 'chungushub.db')), filename = join(dir, 'variant-roundtrip.db');
		try { probe.query('VACUUM INTO ?').run(filename); } finally { probe.close(); }
		const restored = new Database(filename);
		try {
			const turn = restored.query('SELECT * FROM messages WHERE chat_id = ?').get(id) as any;
			const variants = restored.query('SELECT * FROM message_variants WHERE message_id = ? ORDER BY ordinal').all(turn.id) as any[];
			expect(turn.selected_variant_id).toBe(source[0].selectedVariantId);
			expect(variants.map(v => JSON.parse(v.payload_json).content)).toEqual(['Selected', 'Inactive']);
			expect(restored.query('PRAGMA foreign_key_check').all()).toEqual([]);
		} finally { restored.close(); }
	});

	test('whole-chat duplicate detection includes inactive versions', () => {
		const id = chat(); db.seedConversationGreetings(id, ['A', 'B']);
		const copy = db.duplicateChat({ chatId: id, title: 'Copy', includeMemory: false });
		const control = db.duplicateChat({ chatId: id, title: 'Control', includeMemory: false });
		expect(db.getChatContentGroups()[copy]).toBe(db.getChatContentGroups()[id]);
		const probe = new Database(join(dir, 'chungushub.db'));
		try { probe.run("UPDATE message_variants SET payload_json = json_set(payload_json, '$.content', 'Different inactive version') WHERE id = ?",
			[rows(copy)[0].variants[1].id]); } finally { probe.close(); }
		const groups = db.getChatContentGroups();
		expect(groups[id]).toBe(groups[control]);
		expect(groups[id]).toBeDefined();
		expect(groups[copy]).not.toBe(groups[id]);
	});
});

describe('legacy conversion', () => {
	test('preserves the primary history, ambiguous continuations, raw payloads and complete references', () => {
		const id = chat(false), root = crypto.randomUUID(), reply = crypto.randomUUID(), alternate = crypto.randomUUID();
		db.insertMessage({ id: root, chatId: id, parentId: null, role: 'user', content: 'Question', createdAt: 1 });
		db.insertMessage({ id: reply, chatId: id, parentId: root, role: 'assistant', content: 'A', thinking: 'Thought A', isBookmarked: true, createdAt: 2 });
		db.insertMessage({ id: alternate, chatId: id, parentId: root, role: 'assistant', content: 'B', createdAt: 3, siblingIndex: 1 });
		db.updateChat({ id, rootMessageId: root, activeLeafId: reply, canonLeafId: alternate });
		const scene = db.saveMemoryScene({ chatId: id, title: 'Before', content: 'Summary', source: captureScene(rows(id).filter(m => m.id !== alternate)) });
		db.migrateLegacyConversation(id);
		expect(rows(id).map(m => m.content)).toEqual(['Question', 'A']);
		expect(rows(id)[1].variants[0].thinking).toBe('Thought A');
		expect(rows(id)[1].variants[0].isBookmarked).toBe(true);
		const probe = new Database(join(dir, 'chungushub.db'));
		try {
			const provenance = probe.query('SELECT * FROM conversation_provenance WHERE chat_id = ?').get(id) as any;
			const branches = probe.query('SELECT chat_id FROM conversation_provenance WHERE archive_id = ? AND chat_id != ?').all(provenance.archive_id, id) as any[];
			expect(branches).toHaveLength(1); expect(rows(branches[0].chat_id).map(m => m.content)).toEqual(['Question', 'B']);
			const archive = probe.query('SELECT payload_json FROM conversation_archives WHERE id = ?').get(provenance.archive_id) as any;
			expect(JSON.parse(archive.payload_json).messages).toHaveLength(3);
			expect(db.getMemoryScenes(id)[0].source[1].variantId).toBe(rows(id)[1].selectedVariantId);
			expect(resolveScenes(db.getMemoryScenes(id), rows(id))[0].status).toBe('active');
			expect(db.getMemoryScenes(id)[0].id).toBe(scene.id);
			const count = db.getAllChats().length; db.migrateLegacyConversation(id); expect(db.getAllChats()).toHaveLength(count);
		} finally { probe.close(); }
	});

	test('explicit swipe classification retains ordering and the selected version', () => {
		const id = chat(false), first = crypto.randomUUID(), second = crypto.randomUUID();
		db.insertMessage({ id: first, chatId: id, parentId: null, role: 'assistant', content: 'First', createdAt: 1 });
		db.insertMessage({ id: second, chatId: id, parentId: null, role: 'assistant', content: 'Second', createdAt: 2, siblingIndex: 1 });
		db.updateChat({ id, rootMessageId: first, activeLeafId: second });
		db.migrateLegacyConversation(id, [{ messageIds: [first, second] }]);
		expect(rows(id)).toHaveLength(1); expect(rows(id)[0].content).toBe('Second');
		expect(rows(id)[0].variants.map((v: any) => v.content)).toEqual(['First', 'Second']);
	});

	test('a failed conversion rolls back chats, versions, archives and the original forest', () => {
		const id = chat(false), root = crypto.randomUUID();
		db.insertMessage({ id: root, chatId: id, parentId: null, role: 'user', content: 'Original', createdAt: 1 });
		db.updateChat({ id, rootMessageId: root, activeLeafId: root });
		const before = rows(id), probe = new Database(join(dir, 'chungushub.db'));
		try {
			probe.exec("CREATE TRIGGER reject_conversion BEFORE INSERT ON message_variants BEGIN SELECT RAISE(ABORT, 'Conversion interrupted'); END;");
			expect(() => db.migrateLegacyConversation(id)).toThrow('interrupted');
			expect(rows(id)).toEqual(before); expect((db.getChat(id) as any).conversationVersion).toBe(1);
			expect(probe.query('SELECT COUNT(*) AS n FROM conversation_provenance WHERE chat_id = ?').get(id)).toEqual({ n: 0 });
		} finally { probe.exec('DROP TRIGGER reject_conversion'); probe.close(); }
	});

	test('opening a format-51 database converts data and checkpoints exactly once', async () => {
		const upgrade = join(dir, 'upgrade'); mkdirSync(upgrade);
		const filename = join(upgrade, 'chungushub.db'), original = new Database(filename);
		const { MIGRATIONS_FOR_TESTS, LATEST_SCHEMA_VERSION } = await import('./db');
		try {
			original.exec('CREATE TABLE _migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
			for (const migration of MIGRATIONS_FOR_TESTS.filter(m => m.version < 52)) {
				original.exec(migration.sql); original.run('INSERT INTO _migrations VALUES (?, ?, 1)', [migration.version, migration.name]);
			}
			original.exec("ALTER TABLE messages ADD COLUMN custom_metadata TEXT;");
			original.exec("INSERT INTO chats(id, title, created_at, updated_at, root_message_id, active_leaf_id) VALUES ('legacy', 'Old', 1, 2, 'root', 'missing');");
			original.exec("INSERT INTO messages(id, chat_id, role, content, created_at) VALUES ('root', 'legacy', 'assistant', 'Original', 1);");
			original.exec("UPDATE messages SET custom_metadata = 'Unknown field preserved';");
		} finally { original.close(); }
		db.closeForTests(); process.env.CHUNGUS_DATA_DIR = upgrade;
		try {
			expect(() => db.open()).toThrow('pointer');
			const failed = new Database(filename);
			try {
				expect(failed.query('SELECT MAX(version) AS v FROM _migrations').get()).toEqual({ v: 51 });
				expect(failed.query("SELECT name FROM sqlite_master WHERE name = 'message_variants'").all()).toEqual([]);
				failed.exec("UPDATE chats SET active_leaf_id = 'root';");
			} finally { failed.close(); }
			db.open(); expect(db.schemaVersion()).toBe(LATEST_SCHEMA_VERSION);
			expect(rows('legacy')[0].variants[0].content).toBe('Original');
			const id = rows('legacy')[0].selectedVariantId;
			db.closeForTests(); db.open(); expect(rows('legacy')[0].selectedVariantId).toBe(id);
			const probe = new Database(filename);
			try {
				expect(probe.query('PRAGMA foreign_key_check').all()).toEqual([]);
				expect(probe.query("SELECT json_extract(payload_json, '$.custom_metadata') AS metadata FROM message_variants").get()).toEqual({ metadata: 'Unknown field preserved' });
			}
			finally { probe.close(); }
		} finally { db.closeForTests(); process.env.CHUNGUS_DATA_DIR = dir; }
	});
});
