import type { SpeechRule } from './speech-rules';

export const SPEECH_RULE_FILE_LIMIT = 512 * 1024;
const FORMAT = 'chungus-speech-rules';

/** Validate imported data without executing regex. Compilation stays in the terminable worker. */
function checked(value: unknown): SpeechRule[] {
 if (!Array.isArray(value) || value.length > 30) throw new Error('Use at most 30 speech rules.');
 const ids = new Set<string>();
 const rules = value.map((item: unknown, index): SpeechRule => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid rule ${index + 1}.`);
  const rule = item as Record<string, unknown>;
  if (typeof rule.id !== 'string' || !rule.id.trim() || rule.id.length > 80 || ids.has(rule.id))
   throw new Error('Speech rule IDs must be unique and contain 1 to 80 characters.');
  ids.add(rule.id);
  if (typeof rule.pattern !== 'string' || !rule.pattern.trim() || rule.pattern.length > 1000)
   throw new Error(`Rule ${index + 1} needs 1 to 1,000 characters in Match text.`);
  if (rule.name !== undefined && (typeof rule.name !== 'string' || rule.name.length > 120))
   throw new Error(`Rule ${index + 1} has an invalid name (maximum 120 characters).`);
  if (rule.replacement !== undefined && (typeof rule.replacement !== 'string' || rule.replacement.length > 1000))
   throw new Error(`Rule ${index + 1} has an invalid replacement (maximum 1,000 characters).`);
  if (typeof rule.regex !== 'boolean' || typeof rule.caseSensitive !== 'boolean' || typeof rule.enabled !== 'boolean')
   throw new Error(`Rule ${index + 1} has invalid options.`);
  return { id: rule.id, name: rule.name ?? '', pattern: rule.pattern, replacement: rule.replacement ?? '',
   regex: rule.regex, caseSensitive: rule.caseSensitive, enabled: rule.enabled } as SpeechRule;
 });
 // Match the complete escaped payload bound enforced by the native bridge.
 if (JSON.stringify({ rules }).length > 99000) throw new Error('Speech rules are too large to save.');
 return rules;
}

export function serializeSpeechRules(rules: SpeechRule[]): string {
 return JSON.stringify({ format: FORMAT, version: 1, rules: checked(rules) }, null, 2);
}

export function parseSpeechRulesImport(text: string): SpeechRule[] {
 if (text.length > SPEECH_RULE_FILE_LIMIT) throw new Error('Rule files must be smaller than 512 KB.');
 let value: unknown;
 try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
 catch { throw new Error('Choose a valid speech rules JSON file.'); }
 // A raw device rules array also supports backups made before the versioned export format.
 if (Array.isArray(value)) return checked(value);
 if (!value || typeof value !== 'object') throw new Error('Choose a Chungus speech rules export.');
 const file = value as Record<string, unknown>;
 if (file.format !== FORMAT) throw new Error('Choose a Chungus speech rules export.');
 if (file.version !== 1) throw new Error('This speech rules file version is not supported. Update Chungus.');
 return checked(file.rules);
}

/** New IDs allow importing the same backup twice without coupling or replacing existing rows. */
export function appendSpeechRules(current: SpeechRule[], imported: SpeechRule[], createId = () => crypto.randomUUID()): SpeechRule[] {
 return checked([...current, ...imported.map(rule => ({ ...rule, id: createId() }))]);
}
