/** Extract only the rendered story. This receives the same sanitized HTML displayed
 * by Message, after display macros and regex rules; reasoning and image URLs stay out. */
export function readAloudText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	doc.querySelectorAll('script,style,img,audio,video,iframe,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
	doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
	doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,summary,tr').forEach(node => node.append('\n'));
	return (doc.body.textContent ?? '').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
