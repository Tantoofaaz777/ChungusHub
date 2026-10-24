import { renderMarkdown } from './markdown';

/** Speech starts from the original message with identity macros resolved, before any
 * display-scope regex. Render just to remove formatting safely: HTML comments, reasoning
 * and image URLs never become spoken story. Device-local TTS rules run on the result. */
export function readAloudText(source: string): string {
	const doc = new DOMParser().parseFromString(renderMarkdown(source), 'text/html');
	doc.querySelectorAll('script,style,img,audio,video,iframe,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
	doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
	doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,summary,tr').forEach(node => node.append('\n'));
	return (doc.body.textContent ?? '').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
