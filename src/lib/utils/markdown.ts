import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { isDecorationColor, sanitizeDecorations } from './inline-decoration';
import { prepareModelMarkup } from './model-markup';

// Configure marked for safe rendering
marked.setOptions({
	gfm: true,
	breaks: true
});

/**
 * Validate inline typography and decoration, and hold the legacy
 * `<font color>` to the same colour grammar. Registered once, globally: this is the only
 * sanitize call in the app, and narrowing `style` is safe for anything that joins it.
 *
 * DOMPurify decides which tags and attributes may exist at all; this decides what a `style`
 * that survived is allowed to say. Both halves are needed: `ALLOWED_ATTR` alone would let
 * `style="position:fixed;inset:0"` through untouched.
 *
 * What survives here is also what `.prose` reads to decide that a preset's colour outranks
 * the app's own prose accents, and it reads it off the elements themselves rather than off
 * a marker written here (see the note beside that rule in app.css). The serialized shape
 * `sanitizeDecorations` produces is therefore load-bearing beyond this file.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (!(node instanceof Element)) return;

	const style = node.getAttribute('style');
	if (style !== null) {
		const safe = sanitizeDecorations(style);
		if (safe) node.setAttribute('style', safe);
		else node.removeAttribute('style');
	}

	const color = node.getAttribute('color');
	if (color !== null && !isDecorationColor(color)) node.removeAttribute('color');
});

/**
 * Quote pairs to highlight as dialogue. Each entry: [open, close, displayOpen, displayClose]
 * Covers: straight quotes, curly quotes, German quotes, guillemets, CJK brackets, ornamental quotes
 */
const QUOTE_PAIRS: [string, string, string, string][] = [
	// Straight double quotes (HTML-encoded by marked)
	['&quot;', '&quot;', '"', '"'],
	// Curly/smart double quotes (English)
	['\u201C', '\u201D', '"', '"'],
	// German/Polish style „..." (low-9 opening)
	['\u201E', '\u201D', '„', '"'],
	['\u201E', '\u201C', '„', '"'],
	// Guillemets «...» (French, Russian, etc.)
	['\u00AB', '\u00BB', '«', '»'],
	// Reversed guillemets »...« (German, some Slavic)
	['\u00BB', '\u00AB', '»', '«'],
	// CJK double angle brackets 《...》
	['\u300A', '\u300B', '《', '》'],
	// CJK corner brackets 「...」
	['\u300C', '\u300D', '「', '」'],
	// CJK white corner brackets 『...』
	['\u300E', '\u300F', '『', '』'],
	// Heavy ornamental quotes ❝...❞
	['\u275D', '\u275E', '❝', '❞'],
	// Double prime quotes 〝...〞
	['\u301D', '\u301E', '〝', '〞'],
	// Fullwidth quotes ＂...＂
	['\uFF02', '\uFF02', '＂', '＂']
];

/**
 * Highlight quoted text by wrapping in a span, skipping code blocks.
 * Handles all common quote styles from various languages and LLM outputs.
 */
function highlightQuotes(html: string): string {
	// Split by code/pre tags to avoid processing them
	const parts = html.split(/(<(?:code|pre)[^>]*>[\s\S]*?<\/(?:code|pre)>)/gi);
	return parts
		.map((part, index) => {
			// Odd indices are code/pre blocks, skip them
			if (index % 2 === 1) return part;

			let result = part;
			for (const [open, close, displayOpen, displayClose] of QUOTE_PAIRS) {
				// Escape special regex chars
				const openEsc = open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const closeEsc = close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				// Use negative lookahead for multi-char patterns (like &quot;), simple negation for single chars
				const contentPattern =
					close.length > 1 ? `(?:(?!${closeEsc}).)+` : `[^${closeEsc}]+`;
				const pattern = new RegExp(`${openEsc}(${contentPattern})${closeEsc}`, 'g');
				result = result.replace(pattern, `<span class="quoted-text">${displayOpen}$1${displayClose}</span>`);
			}
			return result;
		})
		.join('');
}

/**
 * Render markdown content to sanitized HTML.
 */
export function renderMarkdown(content: string): string {
	const rawHtml = marked.parse(prepareModelMarkup(content), { async: false }) as string;
	const withQuotes = highlightQuotes(rawHtml);
	return DOMPurify.sanitize(withQuotes, {
		ALLOWED_TAGS: [
			'p',
			'br',
			'strong',
			'em',
			'code',
			'pre',
			'blockquote',
			'ul',
			'ol',
			'li',
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'a',
			'hr',
			'del',
			'table',
			'thead',
			'tbody',
			'tr',
			'th',
			'td',
			'span',
			// The presentation set. A preset instructs the model to print folding panels of
			// story state, so `details`/`summary` are the panels themselves (native
			// disclosure, no script anywhere) and `div` is the block they are built from.
			// `b`/`i`/`u`/`font` are what real presets write by hand instead of markdown.
			'details',
			'summary',
			'div',
			'b',
			'i',
			'u',
			'font'
		],
		// `style` and `color` are narrowed to pure decoration by the hook above; `open` is
		// a panel's own start state, which is disclosure, not layout.
		ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'color', 'open'],
		// Allowing an attribute is not enough to keep its VALUE. Anything DOMPurify does not
		// consider inert is additionally matched against ALLOWED_URI_REGEXP and dropped when
		// it fails, and its inert list is a fixed set that happens to contain `style` and
		// `class` but not `color`. So a hex colour was being read as a URL, failing the
		// deliberately narrow pattern below, and `<font color>` was silently deleted on the
		// way in: the one form of colour every preset writes, gone before any stylesheet
		// could have a say. Naming it here says what is true: it is a colour, not a link,
		// and the hook above is what decides whether it is a colour we accept.
		//
		// `target` and `rel` sit in the list above under the same trap and would not survive
		// either; nothing emits them today, so they are left as they are rather than granted
		// a pass they have no use for.
		ADD_URI_SAFE_ATTR: ['color'],
		ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i
	});
}

/**
 * Strip markdown to plain text (for previews).
 */
export function stripMarkdown(content: string): string {
	return content
		.replace(/#{1,6}\s/g, '') // Headers
		.replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
		.replace(/\*([^*]+)\*/g, '$1') // Italic
		.replace(/`([^`]+)`/g, '$1') // Inline code
		.replace(/```[\s\S]*?```/g, '') // Code blocks
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, '') // Images
		.replace(/^\s*[-*+]\s/gm, '') // List items
		.replace(/^\s*\d+\.\s/gm, '') // Numbered lists
		.replace(/^\s*>\s/gm, '') // Blockquotes
		.replace(/\n{2,}/g, '\n') // Multiple newlines
		.trim();
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 1) + '\u2026';
}
