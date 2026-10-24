export interface SpeechRule {
 id: string;
 /** Optional for rules saved before APK 0.1.10. Metadata only, never part of speech. */
 name?: string;
 pattern: string;
 regex: boolean;
 caseSensitive: boolean;
 enabled: boolean;
}
export interface SpeechRuleResult { text: string; errors: Record<string, string> }

/** Run only inside the disposable worker: user regex must never block the UI. */
export function applySpeechRules(text: string, rules: SpeechRule[]): SpeechRuleResult {
 if (text.length > 80000 || rules.length > 30) throw new Error('Text or rule limit exceeded.');
 const errors: Record<string, string> = Object.create(null);
 for (const rule of rules) {
  if (!rule.pattern.trim() || rule.pattern.length > 1000) { errors[rule.id] = 'Enter between 1 and 1,000 characters.'; continue; }
  try {
   const pattern = rule.regex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   const expression = new RegExp(pattern, rule.caseSensitive ? 'gu' : 'giu');
   if (rule.enabled) text = text.replace(expression, '');
  } catch { errors[rule.id] = 'Invalid regular expression.'; }
 }
 return { text: text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim(), errors };
}
