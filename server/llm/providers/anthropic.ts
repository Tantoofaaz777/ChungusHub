import type { ProviderProfile } from './types';
import { AnthropicNativeProvider } from '../anthropic-native';

/**
 * Anthropic via its NATIVE Messages API (/v1/messages). See
 * AnthropicNativeProvider for the implementation. Routing it through the generic
 * OpenAI-compat shim instead silently drops thinking, prompt caching and top_k;
 * the native surface keeps them all.
 *
 * paramPolicy is 'reported': the provider synthesizes each model's
 * supportedParameters from the live /models `capabilities` object, so the
 * sampling UI hides temperature/top_p/top_k on the model generations whose API
 * rejects them (Opus 4.7+, Sonnet 5, Fable 5) and shows them everywhere else.
 * Model normalization lives in the provider class (it also feeds the
 * capability cache), so no profile hooks are needed here.
 */
export const anthropic: ProviderProfile = {
	name: 'anthropic',
	displayName: 'Anthropic',
	defaultBaseUrl: 'https://api.anthropic.com/v1',
	requiresApiKey: true,
	baseUrlEditable: false,
	paramPolicy: 'reported',
	// Declared for UI gating; the native provider translates these itself:
	// effort → output_config.effort on adaptive models / budget_tokens on older
	// enabled-style models, visibility → thinking.display, off → thinking omitted
	// or {type: "disabled"}. Values here are the adaptive-effort vocabulary.
	reasoning: {
		efforts: { minimal: 'low', low: 'low', medium: 'medium', high: 'high', max: 'max' },
		offViaThinking: true,
		exclude: true,
		gate: 'model'
	},
	// Image blocks (base64) per model capability (image_input from /models);
	// no OpenAI-style detail hint on the Messages API.
	media: { images: true, gate: 'model' },
	// Explicit caching: the native provider places `cache_control` on the system + the
	// conversation-prefix breakpoints when the user enables it; 5m and 1h TTL both honoured.
	caching: { mode: 'explicit', ttl: true },
	createProvider: (profile) => new AnthropicNativeProvider(profile)
};
