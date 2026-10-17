import type { ThreadsRound } from './types';

/** Copy only complete scenes. The caller owns the transaction and the message-id map. */
export function inheritThreadsRounds(
	rounds: ThreadsRound[], chatId: string, messageIds: Map<string, string>, newId: () => string
): ThreadsRound[] {
	return rounds.filter(round => round.messages.length && round.messages.every(m => messageIds.has(m.id))).map(round => {
		const copy = structuredClone(round);
		const versions = new Map(copy.versions.map(v => [v.id, newId()]));
		copy.id = newId(); copy.chatId = chatId; copy.revision = 1;
		copy.messages = copy.messages.map(m => ({ ...m, id: messageIds.get(m.id)! }));
		copy.versions = copy.versions.map(v => ({ ...v, id: versions.get(v.id)! }));
		copy.activeVersionId = versions.get(copy.activeVersionId) ?? copy.versions.at(-1)!.id;
		return copy;
	});
}
