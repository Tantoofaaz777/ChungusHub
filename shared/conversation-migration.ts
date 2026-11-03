/**
 * Read-only plan for replacing the legacy message forest with linear chats and turn variants.
 * This module does not open a database, allocate destination IDs or change runtime chat behavior.
 * See architecture/swipe-branch-separation.md for the target contract and executor requirements.
 */
export interface LegacyConversationMessage {
	id: string;
	chatId: string;
	parentId: string | null;
	role: 'assistant' | 'user' | 'system';
	siblingIndex: number;
	createdAt: number;
}

export interface LegacyConversationSnapshot {
	chatId: string;
	activeLeafId: string | null;
	rootMessageId: string | null;
	canonLeafId: string | null;
	messages: readonly LegacyConversationMessage[];
}

/** Explicit classification from outside the legacy topology; common parent/role is insufficient. */
export interface ConfirmedSwipeGroup {
	messageIds: readonly string[];
}

export interface PlannedConversationTurn {
	/** The legacy row whose version is selected at this position in this destination chat. */
	selectedMessageId: string;
	/** References to complete source rows, including all metadata, rather than copies of their text. */
	variantMessageIds: string[];
}

export interface PlannedConversation {
	sourceLeafId: string | null;
	turns: PlannedConversationTurn[];
}

export interface ConversationMigrationPlan {
	chatId: string;
	/** Keeps the original chat ID and exactly the currently selected history, even an empty prefix. */
	primary: PlannedConversation;
	/** Each entry becomes an independent chat. Shared prefixes receive independent destination IDs. */
	branches: PlannedConversation[];
	/** Preserved as independent histories unless explicitly classified as swipes. */
	unclassifiedAlternatives: { parentId: string | null; messageIds: string[] }[];
	/** Compatibility provenance only; these markers never choose a different primary history. */
	legacyPointers: { rootMessageId: string | null; canonLeafId: string | null };
}

function compareMessages(a: LegacyConversationMessage, b: LegacyConversationMessage): number {
	return a.siblingIndex - b.siblingIndex || a.createdAt - b.createdAt ||
		(a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Preserve the selected path and every remaining terminal path. Only explicitly confirmed
 * assistant siblings become variants. Even a confirmed group cannot collapse continuations:
 * each played history still receives its own chat, selecting the version it actually used.
 * Every walk is iterative: legacy conversation depth is user data.
 */
export function planConversationMigration(
	snapshot: LegacyConversationSnapshot,
	confirmedSwipes: readonly ConfirmedSwipeGroup[] = []
): ConversationMigrationPlan {
	const { chatId, messages, activeLeafId } = snapshot;
	if (!chatId) throw new Error('Conversation migration requires a chat ID.');
	const byId = new Map<string, LegacyConversationMessage>();
	const children = new Map<string | null, LegacyConversationMessage[]>();
	for (const message of messages) {
		if (!message.id || byId.has(message.id)) throw new Error('Legacy message IDs must be present and unique.');
		if (message.chatId !== chatId) throw new Error('Legacy message belongs to another chat.');
		if (!['assistant', 'user', 'system'].includes(message.role) ||
			!Number.isSafeInteger(message.siblingIndex) || message.siblingIndex < 0 ||
			!Number.isFinite(message.createdAt)) throw new Error('Invalid legacy message ordering or role.');
		byId.set(message.id, message);
		const group = children.get(message.parentId) ?? [];
		group.push(message);
		children.set(message.parentId, group);
	}
	for (const message of messages) {
		if (message.parentId !== null && !byId.has(message.parentId)) throw new Error('Legacy message parent is unavailable.');
	}
	for (const pointer of [activeLeafId, snapshot.rootMessageId, snapshot.canonLeafId]) {
		if (pointer !== null && !byId.has(pointer)) throw new Error('Legacy chat pointer is unavailable.');
	}
	if (snapshot.rootMessageId !== null && byId.get(snapshot.rootMessageId)!.parentId !== null) {
		throw new Error('Legacy root pointer must name a root message.');
	}

	// A parent exists for every non-root. Visiting fewer rows from the roots proves a cycle.
	const queue = [...(children.get(null) ?? [])];
	for (let i = 0; i < queue.length; i++) {
		for (const child of children.get(queue[i].id) ?? []) queue.push(child);
	}
	if (queue.length !== messages.length) throw new Error('Legacy message tree contains a cycle.');
	for (const group of children.values()) group.sort(compareMessages);

	const variantsById = new Map<string, LegacyConversationMessage[]>();
	const swipeGroups: LegacyConversationMessage[][] = [];
	for (const confirmation of confirmedSwipes) {
		if (confirmation.messageIds.length < 2 || new Set(confirmation.messageIds).size !== confirmation.messageIds.length) {
			throw new Error('A confirmed swipe group requires at least two distinct messages.');
		}
		const group = confirmation.messageIds.map(id => {
			const message = byId.get(id);
			if (!message) throw new Error('Confirmed swipe message is unavailable.');
			if (variantsById.has(id)) throw new Error('Confirmed swipe groups must not overlap.');
			return message;
		});
		if (group.some(message => message.role !== 'assistant' || message.parentId !== group[0].parentId)) {
			throw new Error('Confirmed swipes must be assistant messages with the same parent.');
		}
		group.sort(compareMessages);
		for (const message of group) variantsById.set(message.id, group);
		swipeGroups.push(group);
	}

	const pathTo = (leafId: string | null): LegacyConversationMessage[] => {
		const path: LegacyConversationMessage[] = [];
		for (let id = leafId; id !== null; ) {
			const message = byId.get(id)!;
			path.push(message);
			id = message.parentId;
		}
		return path.reverse();
	};
	const primaryPath = pathTo(activeLeafId);
	const primaryIds = new Set(primaryPath.map(message => message.id));
	const absorbedLeaves = new Set<string>();
	for (const group of swipeGroups) {
		// Unplayed versions need no extra chat when another member already represents the turn.
		// Played versions keep ALL their terminal paths, however many versions were played.
		const hasContinuation = group.some(message => children.has(message.id));
		const representative = group.find(message => primaryIds.has(message.id)) ?? group[0];
		for (const message of group) {
			if (!children.has(message.id) && message.id !== activeLeafId &&
				(hasContinuation || message.id !== representative.id)) absorbedLeaves.add(message.id);
		}
	}

	const represented = new Set<string>();
	const planPath = (path: LegacyConversationMessage[]): PlannedConversation => ({
		sourceLeafId: path.at(-1)?.id ?? null,
		turns: path.map(message => {
			const variantMessageIds = (variantsById.get(message.id) ?? [message]).map(variant => variant.id);
			for (const id of variantMessageIds) represented.add(id);
			return { selectedMessageId: message.id, variantMessageIds };
		})
	});
	const primary = planPath(primaryPath);
	const branches = messages.filter(message => !children.has(message.id) &&
		message.id !== activeLeafId && !absorbedLeaves.has(message.id))
		.sort(compareMessages).map(message => planPath(pathTo(message.id)));
	if (represented.size !== messages.length) throw new Error('Conversation migration would leave messages unrepresented.');

	const unclassifiedAlternatives = [...children.entries()]
		.map(([parentId, siblings]) => ({ parentId, assistants: siblings.filter(message => message.role === 'assistant') }))
		.filter(({ assistants }) => assistants.length > 1 &&
			!assistants.every(message => variantsById.get(message.id) === variantsById.get(assistants[0].id) &&
				variantsById.has(message.id)))
		.map(({ parentId, assistants }) => ({ parentId, messageIds: assistants.map(message => message.id) }))
		.sort((a, b) => a.parentId === b.parentId ? 0 : a.parentId === null ? -1 :
			b.parentId === null ? 1 : a.parentId < b.parentId ? -1 : 1);

	return {
		chatId, primary, branches, unclassifiedAlternatives,
		legacyPointers: { rootMessageId: snapshot.rootMessageId, canonLeafId: snapshot.canonLeafId }
	};
}
