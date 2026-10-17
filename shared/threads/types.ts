import type { Ao3Information } from './ao3';

export interface ThreadsComment { username: string; body: string; score: number; replies: ThreadsComment[] }
export interface ThreadsFeed {
	title: string;
	post: { username: string; body: string; score: number };
	comments: ThreadsComment[];
}
export interface ThreadsMessage {
	id: string; index: number; role: 'system' | 'user' | 'assistant'; content: string; speaker: string;
}
export interface ThreadsVersion { id: string; createdAt: number; feed: ThreadsFeed }
export interface ThreadsRound {
	id: string; chatId: string; label: string; createdAt: number; revision: number;
	messages: ThreadsMessage[]; versions: ThreadsVersion[]; activeVersionId: string;
}
export interface ThreadsNotesPatch { notes?: string; ao3?: Ao3Information; promptId?: string | null }
export interface ThreadsData { rounds: ThreadsRound[]; notes: string; ao3: Ao3Information; promptId: string | null }
export interface SaveThreadsRound {
	id: string; chatId: string; label: string; messages: ThreadsMessage[]; feed: ThreadsFeed;
	/** Branch being read when generation began; older clients fall back to the chat's path. */
	branchLeafId?: string;
}
