export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type CustomBody = Record<string, JsonValue>;

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isObject(value) && Object.values(value).every(isJsonValue);
}

/** The message assembly and response reader must agree with the actual wire request. */
const MANAGED_FIELDS = ['model', 'messages', 'stream'] as const;

export function customBodyError(value: unknown): string | null {
	if (!isObject(value)) return 'Use a JSON object, not an array, null or a single value.';
	for (const field of MANAGED_FIELDS) {
		if (Object.hasOwn(value, field)) return `"${field}" is managed by ChungusHub and cannot be set in Custom body.`;
	}
	return isJsonValue(value) ? null : 'Use valid JSON values and finite numbers.';
}

export function parseCustomBody(text: string): { ok: true; value: CustomBody | undefined } | { ok: false; error: string } {
	if (!text.trim()) return { ok: true, value: undefined };
	let value: unknown;
	try { value = JSON.parse(text); }
	catch (error) { return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }; }
	const error = customBodyError(value);
	if (error) return { ok: false, error };
	return { ok: true, value: Object.keys(value as CustomBody).length ? value as CustomBody : undefined };
}

/** Custom objects extend existing objects; arrays, null and primitives replace the field.
 * Object.fromEntries defines even __proto__ as data without changing an object's prototype. */
export function mergeCustomBody(body: Record<string, unknown>, customBody?: CustomBody): Record<string, unknown> {
	if (customBody === undefined) return body;
	const error = customBodyError(customBody);
	if (error) throw new Error(`Custom body: ${error}`);
	function merge(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
		return Object.fromEntries([
			...Object.entries(base),
			...Object.entries(extra).map(([key, value]) => {
				const previous = Object.hasOwn(base, key) ? base[key] : undefined;
				return [key, isObject(previous) && isObject(value) ? merge(previous, value) : value];
			})
		]);
	}
	return merge(body, customBody);
}
