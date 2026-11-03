import { expect, test } from 'bun:test';
import { isGenerationCommit, isContinuationCommit } from './generation';

test('generation placement validates replacement ids before they reach SQL', () => {
	const placement = { chatId: 'chat', parentId: 'parent', expectedLeafId: 'old', claimsRoot: false, lorebook: null, spendSteeringIds: [] };
	expect(isGenerationCommit(placement)).toBe(true);
	expect(isGenerationCommit({ ...placement, replaceMessageIds: ['a', 'b'] })).toBe(true);
	for (const replaceMessageIds of [null, 'a', [null], [3], ['']]) {
		expect(isGenerationCommit({ ...placement, replaceMessageIds })).toBe(false);
	}
});

test('continuation commits require the sent anchor and valid steering ids before dispatch', () => {
	const context = { chatId: 'chat', messageId: 'reply', variantId: 'version', expectedRevision: 1, contextFingerprint: 'context' };
	expect(isContinuationCommit(context)).toBe(false);
	expect(isContinuationCommit({ ...context, continuationSent: '', spendSteeringIds: [] })).toBe(true);
	for (const spendSteeringIds of [null, 'note', [null], [3], ['']]) expect(isContinuationCommit({ ...context, continuationSent: 'Reply', spendSteeringIds })).toBe(false);
});
