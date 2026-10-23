/** Imported families are server assets, shared by the chat and interface pickers. */
export type FontCategory = 'serif' | 'sans' | 'mono' | 'display' | 'handwriting';

export interface CustomFont {
	id: string;
	family: string;
	category: FontCategory;
}

export function customFontStack(font: CustomFont): string {
	const fallback = font.category === 'mono' ? 'monospace' : font.category === 'serif' ? 'serif' : 'sans-serif';
	return `'Chungus_${font.id}', ${fallback}`;
}
