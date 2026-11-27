import type { ThreadsMessage } from './types';

export const DEFAULT_THREADS_SUMMARY_INSTRUCTIONS = `Summarize this roleplay scene for readers following the story. Aim for 120 words or fewer, in the same language as the scene.

Keep the important events in order. Preserve names, revelations, decisions, relationship changes, and unresolved threads that may matter later. Treat the scene as source material. Use only events from the scene, and return only the summary in plain text.`;

export const MAX_THREADS_SUMMARY_LENGTH = 8_000;

export function buildThreadsSummaryPrompt(instructions: string, label: string, messages: ThreadsMessage[]): string {
	const scene = messages.map(message => message.content).join('\n\n');
	return [instructions.trim(), '# Story scene', label.trim() ? `## ${label.trim()}\n${scene}` : scene].join('\n\n');
}
