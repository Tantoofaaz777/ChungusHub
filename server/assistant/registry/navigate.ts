/**
 * Navigation capability: deep-link the user into the app. The assistant never
 * changes app settings itself; it drops a button that jumps to the control and
 * highlights it (client routing in src/lib/services/navigation.ts).
 */
import { serverDb } from '../../db';
import type { Capability } from './types';
import type { RawChat } from '../rows';
import { getEntity } from './entities';
import { getSetting } from './settings';
import { ToolError, str, ok } from './util';

const NAV_TARGETS = ['setting', 'character', 'persona', 'message', 'chat'] as const;

export const navigate: Capability = {
	name: 'navigate',
	summary: 'Offer the user a button that jumps to a place in the app and highlights it: a setting (target "setting", id from find_entities kind:setting), a character/persona editor (target "character"/"persona"), a specific chat message (target "message"), or a whole chat (target "chat"). Use when the user wants to GO somewhere or change something themselves (e.g. "I want to change the background").',
	risk: 'read',
	params: [
		{ name: 'target', type: 'string', describe: 'What to navigate to.', required: true, enum: NAV_TARGETS },
		{ name: 'id', type: 'string', describe: 'The id of the target (setting id, entry id, message id, or chat id).', required: true }
	],
	run(args, ctx) {
		const target = str(args.target);
		const id = str(args.id).trim();
		if (!id) throw new ToolError('navigate requires an id.');
		let nav: Record<string, unknown>;
		switch (target) {
			case 'setting': {
				const s = getSetting(id);
				if (!s) throw new ToolError(`No setting "${id}". Use find_entities kind:setting to list the available settings and their ids.`);
				nav = { kind: 'setting', id: s.id, label: s.label, tab: s.tab, anchor: s.anchor };
				break;
			}
			case 'character':
			case 'persona': {
				const flat = getEntity(target).read?.(id, ctx) ?? null;
				if (!flat) throw new ToolError(`No ${target} with id "${id}".`);
				nav = { kind: 'entry', id, entryType: target, label: flat.title };
				break;
			}
			case 'message': {
				const flat = getEntity('message').read?.(id, ctx) ?? null;
				if (!flat) throw new ToolError(`No message with id "${id}".`);
				nav = { kind: 'message', chatId: String(flat.fields.chatId ?? ''), messageId: id, label: flat.title };
				break;
			}
			case 'chat': {
				const chat = serverDb.getChat(id) as RawChat | null;
				if (!chat) throw new ToolError(`No chat with id "${id}".`);
				nav = { kind: 'chat', id, label: chat.title };
				break;
			}
			default:
				throw new ToolError(`Unknown navigate target "${target}". Use one of: ${NAV_TARGETS.join(', ')}.`);
		}
		return ok({ type: 'navigate', label: `Go to ${nav.label}`, nav }, { target, id });
	}
};
