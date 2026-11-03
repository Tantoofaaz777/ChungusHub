import type { ConversationPlacement } from './conversation';

export interface RecoveredGeneration {
	id: string;
	chatId: string;
	createdAt: number;
	reason: string;
	payload: unknown;
}

/** Old records and continuation patches share a reader; never coerce arbitrary payloads to text. */
export function recoveredResponse(record: RecoveredGeneration): { content: string; thinking: string; kind: 'Continuation' | 'Response' } {
	const payload = record.payload && typeof record.payload === 'object' ? record.payload as {
		content?: unknown; thinking?: unknown; patch?: unknown; placement?: ConversationPlacement
	} : {};
	const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch as { content?: unknown; thinking?: unknown } : null;
	const source = patch ?? payload;
	return { content: typeof source.content === 'string' ? source.content : '',
		thinking: typeof source.thinking === 'string' ? source.thinking : '', kind: patch ? 'Continuation' : 'Response' };
}
