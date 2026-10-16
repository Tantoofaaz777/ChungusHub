import { expect, test } from 'bun:test';
import { isGenerationCommit } from './generation';

test('generation placement validates replacement ids before they reach SQL', () => {
	const placement = { chatId: 'chat', parentId: 'parent', expectedLeafId: 'old', claimsRoot: false, lorebook: null, spendSteeringIds: [] };
	expect(isGenerationCommit(placement)).toBe(true);
	expect(isGenerationCommit({ ...placement, replaceMessageIds: ['a', 'b'] })).toBe(true);
	for (const replaceMessageIds of [null, 'a', [null], [3], ['']]) {
		expect(isGenerationCommit({ ...placement, replaceMessageIds })).toBe(false);
	}
});
