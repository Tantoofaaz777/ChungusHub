import { isAndroidClient } from '#lib/services/android-client.ts';

/** The app's only clipboard writer. Callers must await it before showing success.
 * Android confirms a native write; browsers use their Clipboard API, with a selection
 * fallback both on plain HTTP and when the modern API refuses permission or focus.
 * Never read a browser clipboard just to verify: that requires a separate permission.
 */
export async function copyText(text: string): Promise<void> {
	if (!text.length) throw new Error('There is no text to copy.');
	if (isAndroidClient() && window.ChungusAndroidClient?.copyText) {
		// A native failure must reach the UI, not become a WebView's false success.
		await window.ChungusAndroidClient.copyText(text);
		return;
	}
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return;
		}
	} catch { /* The browser may still permit copying the selected text. */ }
	if (!selectionCopy(text)) throw new Error('This browser refused the copy.');
}

/** `execCommand('copy')` over a throwaway textarea, the pre-secure-context path. */
function selectionCopy(text: string): boolean {
	const previous = document.activeElement as HTMLElement | null;
	const selection = window.getSelection();
	const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
	const input = previous instanceof HTMLInputElement || previous instanceof HTMLTextAreaElement ? previous : null;
	const caret = input && input.selectionStart !== null
		? { start: input.selectionStart, end: input.selectionEnd!, direction: input.selectionDirection ?? undefined }
		: null;
	const field = document.createElement('textarea');
	field.value = text;
	// Off-screen rather than hidden: a display:none or visibility:hidden node holds no
	// selection, and a node with real size would scroll the page on focus.
	field.style.cssText =
		'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0';
	// Read-only keeps the on-screen keyboard down. iOS is the exception: it selects
	// nothing in a read-only field and needs an editable one with an explicit range.
	field.readOnly = true;
	// A native modal makes the rest of the document inert, including body children.
	(document.querySelector('dialog[open]:not([inert])') ?? document.body).appendChild(field);
	try {
		field.focus({ preventScroll: true });
		if (/iP(ad|hone|od)/.test(navigator.userAgent)) {
			field.readOnly = false;
			field.contentEditable = 'true';
			const range = document.createRange();
			range.selectNodeContents(field);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			field.setSelectionRange(0, text.length);
		} else {
			field.select();
			field.setSelectionRange(0, text.length);
		}
		return document.execCommand('copy');
	} finally {
		field.remove();
		if (selection) {
			selection.removeAllRanges();
			for (const range of ranges) selection.addRange(range);
		}
		if (previous?.isConnected && !previous.closest('[inert]')) {
			previous.focus({ preventScroll: true });
			// Restoring a document range can reset a field's caret in Chromium.
			// Restore the input selection last, after both document selection and focus.
			if (input && caret) input.setSelectionRange(caret.start, caret.end, caret.direction);
		}
	}
}
