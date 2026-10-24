import { beforeAll, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

let source: string;
beforeAll(async () => { source = await Bun.file(new URL('../components/chat/InputArea.svelte', import.meta.url)).text(); });

function harness() {
	const fixture = { resolve: null as unknown as (path: string) => void, removed: [] as string[], cleared: [] as string[], active: 'old', destroy: () => {} };
	const start = source.indexOf('\tlet pendingImages = '), end = source.indexOf('\n\tfunction handlePaste', start);
	const resetStart = source.indexOf('\t\tdraftChatId = chatId;'), resetEnd = source.indexOf('\t\thistoryPos = null;', resetStart);
	const releaseStart = source.indexOf('\tfunction releaseDraft('), releaseEnd = source.indexOf('\n\tfunction handleKeydown', releaseStart);
	if (Math.min(start, end, resetStart, resetEnd) < 0) throw new Error('Composer attachment boundaries changed.');
	const script = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
		let draftChatId = 'old';
		let content = 'New draft', historyPos = null, textareaElement = null;
		${source.slice(start, end)}
		${source.slice(releaseStart, releaseEnd)}
		module.exports = { attachImageFiles, releaseDraft, switchChat() { fixture.active = 'new'; const chatId = 'new'; ${source.slice(resetStart, resetEnd)} },
			get pending() { return pendingImages }, get content() { return content }, get uploading() { return uploadingImages } };
	`);
	const module = { exports: {} as { attachImageFiles(files: File[]): Promise<void>; releaseDraft(chat: string, text: string): void; switchChat(): void; pending: { path: string }[]; content: string; uploading: number } };
	runInNewContext(script, { module, fixture, $state: (value: unknown) => value,
		onDestroy: (fn: () => void) => { fixture.destroy = fn; }, imageRejectionReason: () => null,
		llmService: { sendsImages: () => true }, toastStore: { warning() {}, error() {}, failed() {} },
		chatStore: { get activeChatId() { return fixture.active; } }, inputHistoryStore: { record() {} }, inputDraftStore: { clear: (id: string) => fixture.cleared.push(id) },
		imageService: { saveImage: () => new Promise(resolve => { fixture.resolve = resolve; }),
			thumbnailUrl: (path: string) => path, deleteImage: async (path: string) => { fixture.removed.push(path); } }
	});
	return { fixture, composer: module.exports };
}

test('an upload finishing after a chat switch is released instead of attached to the new chat', async () => {
	const { fixture, composer } = harness();
	const upload = composer.attachImageFiles([new File(['image'], 'image.png')]);
	expect(composer.uploading).toBe(1); composer.switchChat();
	fixture.resolve('images/chat/late.png'); await upload;
	expect(composer.pending).toEqual([]); expect(composer.uploading).toBe(0);
	expect(fixture.removed).toEqual(['images/chat/late.png']);
});

test('destroying the composer releases an upload that finishes later', async () => {
	const { fixture, composer } = harness();
	const upload = composer.attachImageFiles([new File(['image'], 'image.png')]); fixture.destroy();
	fixture.resolve('images/chat/late.png'); await upload;
	expect(composer.pending).toEqual([]); expect(fixture.removed).toEqual(['images/chat/late.png']);
});

test('switching chats removes staged attachments from the new composer', async () => {
	const { fixture, composer } = harness();
	const upload = composer.attachImageFiles([new File(['image'], 'image.png')]); fixture.resolve('images/chat/staged.png'); await upload;
	expect(composer.pending.map(item => item.path)).toEqual(['images/chat/staged.png']);
	composer.switchChat(); expect(composer.pending).toEqual([]);
	// A held send may still commit the old upload. Existing staged files are left for
	// the guarded boot sweep instead of being eagerly deleted on navigation.
	expect(fixture.removed).toEqual([]);
});

test('a late send commit clears its original draft without taking the new chat attachments', async () => {
	const { fixture, composer } = harness(); composer.switchChat();
	const upload = composer.attachImageFiles([new File(['image'], 'image.png')]); fixture.resolve('images/chat/new.png'); await upload;
	composer.releaseDraft('old', 'Old message');
	expect(composer.pending.map(item => item.path)).toEqual(['images/chat/new.png']);
	expect(composer.content).toBe('New draft'); expect(fixture.cleared).toEqual(['old']);
});
