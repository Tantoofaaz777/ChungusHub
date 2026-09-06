/**
 * Live-sync scope vocabulary, shared by both sides of the bridge.
 *
 * The server tags every mutation with one of these and broadcasts it; each client
 * translates the hint into a targeted store reload. A scope that exists on one side
 * only is the quiet failure this module exists to prevent: the mutation succeeds, the
 * broadcast goes out, and the other device just keeps showing stale data.
 *
 * Adding a scope: one entry here, then the compiler names both ends, the server's
 * `MUTATION_SCOPES` (db.ts) and the client's scope→reload table (services/sync.ts,
 * typed `Record<SyncScope, …>`) both stop compiling until they agree.
 */
export const SYNC_SCOPES = [
	'chats',
	'messages',
	'library',
	'lorebooks',
	'steering',
	'settings',
	'drafts',
	'inputHistory',
	'presets',
	'memory',
	'backups'
] as const;

export type SyncScope = (typeof SYNC_SCOPES)[number];
