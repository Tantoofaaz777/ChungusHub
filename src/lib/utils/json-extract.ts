/**
 * Pulling a JSON object out of a model's reply.
 *
 * Shared by engines that ask for structured output (Chat Memory), because
 * a small model wraps its JSON in a fence or a sentence of preamble and each engine inventing
 * its own tolerance is how two engines end up disagreeing about what a valid answer looks like.
 */

/** Pull the first JSON object out of a model response (tolerates fences / stray prose). */
export function parseJsonObject(raw: string): Record<string, unknown> {
	let s = raw.trim();
	if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
	// Fall back to the outermost {...} span if there's leading/trailing noise.
	if (!s.startsWith('{')) {
		const a = s.indexOf('{');
		const b = s.lastIndexOf('}');
		if (a >= 0 && b > a) s = s.slice(a, b + 1);
	}
	try {
		const v = JSON.parse(s);
		return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
