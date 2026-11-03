import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A generation must outlive the socket that asked for it, and a page that comes back must be
 * able to claim what it missed.
 *
 * This is the one test that runs the real server, because the failure it pins only exists
 * where the socket does: a phone that backgrounds its browser has the socket torn down by the
 * OS mid-reply, and nothing below the WebSocket layer can be handed that situation. It spawns
 * the executable against a throwaway data dir and a scripted model endpoint, streams a reply,
 * severs the socket while the model is still writing, and asks a second socket for the rest.
 *
 * The endpoint holds the second half of its answer behind `gate`, so the tokens it sends after
 * the cut are provably produced with nobody listening: if the server still killed generations
 * with their socket, they would never be produced at all.
 */

const TOKENS_BEFORE_CUT = ['Hel', 'lo '];
const TOKENS_AFTER_CUT = ['wor', 'ld.'];

/** The endpoint holds its second half here. Re-armed per test that needs a pause; anything
 *  else runs against a gate that is already open and streams straight through. */
let releaseGate: () => void = () => {};
let gate: Promise<void> = Promise.resolve();
let modelRequests = 0;
function armGate(): void {
	gate = new Promise<void>((resolve) => {
		releaseGate = resolve;
	});
}

function sse(payload: unknown): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

/** An OpenAI-compatible endpoint that answers /v1/models (so the base pins) and streams a
 *  chat completion in two halves with a gate between them. */
const model = Bun.serve({
	port: 0,
	hostname: '127.0.0.1',
	async fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === '/v1/models') {
			return Response.json({ data: [{ id: 'scripted' }] });
		}
		if (path !== '/v1/chat/completions') return new Response('Not found', { status: 404 });
		modelRequests++;

		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const encode = (s: string) => controller.enqueue(new TextEncoder().encode(s));
				for (const token of TOKENS_BEFORE_CUT) {
					encode(sse({ choices: [{ delta: { content: token } }] }));
					await Bun.sleep(10);
				}
				await gate;
				for (const token of TOKENS_AFTER_CUT) {
					encode(sse({ choices: [{ delta: { content: token } }] }));
					await Bun.sleep(10);
				}
				encode(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
				encode(sse({ usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } }));
				encode('data: [DONE]\n\n');
				controller.close();
			}
		});
		return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
	}
});

const scratch = mkdtempSync(join(tmpdir(), 'chungus-gen-'));
let child: ReturnType<typeof Bun.spawn>;
let origin = '';

/** Boot the real server on an OS-assigned port and read that port off its own banner. */
async function bootServer(): Promise<string> {
	child = Bun.spawn([process.execPath, 'server/index.ts'], {
		env: {
			...process.env,
			// The child is a real server, not a test process, and `bun test` puts NODE_ENV=test
			// in the environment it would inherit. config.ts reads exactly that to decide whether
			// to create the data dirs, so inheriting it boots an install with nowhere to write.
			NODE_ENV: 'production',
			CHUNGUS_PORT: '0',
			CHUNGUS_HOST: '127.0.0.1',
			CHUNGUS_DATA_DIR: join(scratch, 'data'),
			CHUNGUS_BACKUP_DIR: join(scratch, 'backups'),
			CHUNGUS_NO_OPEN: '1'
		},
		stdout: 'pipe',
		stderr: 'pipe'
	});

	let errors = '';
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
			errors += decoder.decode(chunk, { stream: true });
		}
	})();

	const decoder = new TextDecoder();
	let banner = '';
	for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
		banner += decoder.decode(chunk, { stream: true });
		const match = banner.match(/http:\/\/localhost:(\d+)/);
		if (match) return `http://127.0.0.1:${match[1]}`;
	}
	await Bun.sleep(50);
	throw new Error(`The server exited before it announced a port.\nstdout:\n${banner}\nstderr:\n${errors}`);
}

/** One WebSocket, open and ready to send. */
function openSocket(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws?clientId=${crypto.randomUUID()}`);
		socket.onopen = () => resolve(socket);
		socket.onerror = () => reject(new Error('The test socket would not open'));
	});
}

/** Collect frames off a socket until `done` says the test has what it waited for. */
function collect(
	socket: WebSocket,
	done: (frames: Record<string, unknown>[]) => boolean
): Promise<Record<string, unknown>[]> {
	const frames: Record<string, unknown>[] = [];
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timed out waiting on frames. Got: ${JSON.stringify(frames)}`)),
			15_000
		);
		socket.onmessage = (event) => {
			const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
			if (frame.t === 'pong') return;
			frames.push(frame);
			if (done(frames)) {
				clearTimeout(timer);
				resolve(frames);
			}
		};
	});
}

const CONNECTION_ID = 'test-connection';

function generateRequest(id: string, commit?: Record<string, unknown>): string {
	return JSON.stringify({
		t: 'llm',
		conversationProtocol: 2,
		id,
		connectionId: CONNECTION_ID,
		provider: 'openai-compatible',
		model: 'scripted',
		messages: [{ role: 'user', content: 'say hello' }],
		stream: true,
		source: 'chat',
		commit
	});
}

/** Call one bridged db method over the RPC endpoint, the same door the client uses. */
async function rpc(method: string, args: unknown[]): Promise<unknown> {
	const res = await fetch(`${origin}/api/rpc/db`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ method, args, clientId: 'test', conversationProtocol: 2 })
	});
	if (!res.ok) throw new Error(`${method} failed: ${res.status} ${await res.text()}`);
	return (await res.json()).result;
}

/** A chat holding one user turn, with the leaf on it: what a send leaves behind. */
async function seedChat(): Promise<{ chatId: string; userTurnId: string }> {
	const chatId = crypto.randomUUID();
	const userTurnId = crypto.randomUUID();
	const now = Date.now();
	await rpc('insertChat', [
		{
			id: chatId,
			title: 'A story',
			createdAt: now,
			updatedAt: now,
			rootMessageId: null,
			activeLeafId: null,
			canonLeafId: null,
			settings: null,
			characterId: null,
			characterVersionId: null
		}
	]);
	await rpc('appendConversationTurn', [
		{ id: userTurnId, chatId, parentId: null, role: 'user', content: 'say hello', createdAt: now, siblingIndex: 0 },
		await rpc('getConversationPlacement', [chatId, 'append'])
	]);
	await rpc('updateChatActiveLeaf', [chatId, userTurnId]);
	return { chatId, userTurnId };
}

async function seedContinuation() {
	const { chatId, userTurnId } = await seedChat(), messageId = crypto.randomUUID();
	await rpc('appendConversationTurn', [{ id: messageId, chatId, parentId: userTurnId, role: 'assistant', content: 'Start.', createdAt: Date.now() }, await rpc('getConversationPlacement', [chatId, 'append'])]);
	const target = (await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!;
	const placement = await rpc('getConversationPlacement', [chatId, 'append']) as any;
	const continuation = { chatId, messageId, variantId: target.selectedVariantId, expectedRevision: target.revision,
		contextFingerprint: placement.contextFingerprint, continuationSent: 'Start.', spendSteeringIds: [] as string[] };
	return { chatId, userTurnId, messageId, continuation };
}
function continueRequest(id: string, continuation: unknown) {
	return JSON.stringify({ ...JSON.parse(generateRequest(id)), source: 'continue', continuation });
}

beforeAll(async () => {
	origin = await bootServer();
	// The registry reads the key and base URL out of connection_credentials per request, so
	// the connection has to exist before the first generation.
	const res = await fetch(`${origin}/api/rpc/db`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			conversationProtocol: 2,
			method: 'setConnectionCredentials',
			args: [CONNECTION_ID, 'openai-compatible', 'test-key', `http://127.0.0.1:${model.port}/v1`],
			clientId: 'test'
		})
	});
	expect(res.status).toBe(200);
});

// The gate is module-level and the endpoint reads it mid-response, so a test that fails
// before its own `releaseGate()` would leave every later generation blocked on a promise
// nothing resolves: one real failure becomes a file of timeouts that hides which assertion
// actually broke. Opening it here runs whatever the outcome.
afterEach(() => {
	releaseGate();
});

afterAll(async () => {
	child?.kill();
	// Windows will not unlink a file another process still has open, and the child holds the
	// SQLite handle until it is actually gone. Waiting on the exit is the difference between
	// a clean scratch dir and a red suite.
	await child?.exited;
	model.stop(true);
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			rmSync(scratch, { recursive: true, force: true });
			return;
		} catch {
			await Bun.sleep(100);
		}
	}
	rmSync(scratch, { recursive: true, force: true });
});

describe('a generation outlives its socket (architecture/server-core.md, WebSocket protocol)', () => {
	test('an old client cannot mutate the new conversation format', async () => {
		const before = await rpc('getAllChats', []);
		const response = await fetch(`${origin}/api/rpc/db`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ method: 'insertChat', args: [{ id: 'old-client', title: 'Unsupported' }] }) });
		expect(response.status).toBe(409);
		expect(await rpc('getAllChats', [])).toEqual(before);
	});

	test('a tree-only generation is refused before the model starts', async () => {
		const { chatId, userTurnId } = await seedChat(), socket = await openSocket();
		const answered = collect(socket, frames => frames.some(frame => frame.t === 'llm-error'));
		socket.send(generateRequest(crypto.randomUUID(), { chatId, parentId: userTurnId, expectedLeafId: userTurnId,
			claimsRoot: false, lorebook: null, spendSteeringIds: [] }));
		expect(String((await answered).find(frame => frame.t === 'llm-error')?.message)).toContain('protocol');
		expect((await rpc('getMessagesByChat', [chatId]) as unknown[])).toHaveLength(1);
		socket.close();
	});
	test('the WebSocket refuses an outdated continuation before calling the provider', async () => {
		const { chatId, userTurnId } = await seedChat();
		const socket = await openSocket();
		try {
			const complete = collect(socket, frames => frames.some(frame => frame.t === 'llm-done'));
			socket.send(generateRequest(crypto.randomUUID(), { chatId, parentId: userTurnId, expectedLeafId: userTurnId,
				claimsRoot: false, spendSteeringIds: [], placement: await rpc('getConversationPlacement', [chatId, 'append']) }));
			await complete;
			const turns = await rpc('getMessagesByChat', [chatId]) as any[], target = turns.at(-1)!, question = turns[0];
			const placement = await rpc('getConversationPlacement', [chatId, 'append']) as any;
			const context = { chatId, messageId: target.id, variantId: target.selectedVariantId, expectedRevision: target.revision, contextFingerprint: placement.contextFingerprint,
				continuationSent: target.content, spendSteeringIds: [] };
			await rpc('validateMessageContinuation', [context]);
			await rpc('updateMessageVariantContent', [{ chatId, messageId: question.id, variantId: question.selectedVariantId,
				expectedRevision: question.revision, content: 'Changed after review' }]);
			const requestsBefore = modelRequests;
			for (const continuation of [context, undefined, { ...context, contextFingerprint: 42 }]) {
				const refused = collect(socket, frames => frames.some(frame => frame.t === 'llm-error'));
				socket.send(JSON.stringify({ ...JSON.parse(generateRequest(crypto.randomUUID())), source: 'continue', continuation }));
				const frames = await refused;
				expect(frames.some(frame => frame.t === 'llm-token')).toBe(false);
				expect(String(frames.find(frame => frame.t === 'llm-error')?.message)).toMatch(/context changed|protocol/);
			}
			expect(modelRequests).toBe(requestsBefore);
			expect((await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!.content).toBe('Hello world.');
		} finally { socket.close(); }
	}, 30_000);

	test('Continue survives its page, is discoverable and blocks both another Continue and a swipe', async () => {
		const { chatId, messageId, continuation } = await seedContinuation(), id = crypto.randomUUID();
		armGate(); const starter = await openSocket(), returning = await openSocket();
		try {
			const started = collect(starter, f => f.some(x => x.t === 'llm-token'));
			starter.send(continueRequest(id, continuation)); await started; starter.close();
			const status = collect(returning, f => f.some(x => x.t === 'llm-status-result'));
			returning.send(JSON.stringify({ t: 'llm-status', id: crypto.randomUUID(), chatIds: [chatId] }));
			expect((await status).find(x => x.t === 'llm-status-result')!.running).toMatchObject([{ chatId, requestId: id }]);
			for (const request of [continueRequest(crypto.randomUUID(), continuation), generateRequest(crypto.randomUUID(), {
				chatId, parentId: messageId, expectedLeafId: messageId, claimsRoot: false, spendSteeringIds: [], placement: await rpc('getConversationPlacement', [chatId, 'add_variant'])
			})]) {
				const refused = collect(returning, f => f.some(x => x.t === 'llm-error'));
				returning.send(request); expect(String((await refused).find(x => x.t === 'llm-error')?.message)).toContain('already being written');
			}
			const landed = collect(returning, f => f.some(x => x.t === 'sync' && x.scope === 'messages'));
			releaseGate(); await landed;
			const target = (await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!;
			expect(target.id).toBe(messageId); expect(target.content).toBe('Start. Hello world.'); expect(target.variants).toHaveLength(1);
			const replay = collect(returning, f => f.some(x => x.t === 'llm-done'));
			returning.send(JSON.stringify({ t: 'llm-attach', id, haveContent: 0, haveThinking: 0 }));
			expect((await replay).find(x => x.t === 'llm-done')!.committedMessageId).toBe(messageId);
			expect((await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!.content).toBe('Start. Hello world.');
		} finally { releaseGate(); starter.close(); returning.close(); }
	}, 30_000);

	test('a returning page can stop Continue and its partial text is persisted by the server', async () => {
		const { chatId, continuation } = await seedContinuation(), id = crypto.randomUUID();
		armGate(); const starter = await openSocket(), returning = await openSocket();
		try {
			const started = collect(starter, f => f.some(x => x.t === 'llm-token'));
			starter.send(continueRequest(id, continuation)); await started; starter.close();
			const landed = collect(returning, f => f.some(x => x.t === 'sync' && x.scope === 'messages'));
			returning.send(JSON.stringify({ t: 'llm-cancel', id })); await landed;
			const target = (await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!;
			expect(target.content).toMatch(/^Start\. Hel/); expect(target.finishReason).toBe('cancelled');
			expect(target.content).not.toContain('world.');
		} finally { releaseGate(); starter.close(); returning.close(); }
	}, 30_000);

	test('Continue recovers completed text after a context edit even if its page has closed', async () => {
		const { chatId, userTurnId, continuation } = await seedContinuation();
		armGate(); const starter = await openSocket(), observer = await openSocket();
		try {
			const started = collect(starter, f => f.some(x => x.t === 'llm-token'));
			starter.send(continueRequest(crypto.randomUUID(), continuation)); await started; starter.close();
			const question = (await rpc('getMessagesByChat', [chatId]) as any[])[0];
			await rpc('updateMessageVariantContent', [{ chatId, messageId: userTurnId, variantId: question.selectedVariantId, expectedRevision: question.revision, content: 'Changed context' }]);
			const recovered = collect(observer, f => f.some(x => x.t === 'sync' && x.scope === 'messages'));
			releaseGate(); await recovered;
			expect((await rpc('getMessagesByChat', [chatId]) as any[]).at(-1)!.content).toBe('Start.');
			expect((await rpc('getRecoveredGenerations', [chatId]) as any[])[0].payload.patch.content).toBe('Start. Hello world.');
		} finally { releaseGate(); starter.close(); observer.close(); }
	}, 30_000);

	test('a generation whose context changed broadcasts recovery and preserves its text outside the transcript', async () => {
		const { chatId, userTurnId } = await seedChat();
		armGate();
		const socket = await openSocket();
		try {
			const started = collect(socket, frames => frames.some(frame => frame.t === 'llm-token'));
			socket.send(generateRequest(crypto.randomUUID(), { chatId, parentId: userTurnId, expectedLeafId: userTurnId,
				claimsRoot: false, spendSteeringIds: [], placement: await rpc('getConversationPlacement', [chatId, 'append']) }));
			await started;
			const turn = (await rpc('getMessagesByChat', [chatId]) as any[])[0];
			await rpc('updateMessageVariantContent', [{ chatId, messageId: turn.id, variantId: turn.selectedVariantId,
				expectedRevision: turn.revision, content: 'Changed during generation' }]);
			// Start collecting after the edit's sync: the next hint must describe recovery.
			const completed = collect(socket, frames => frames.some(frame => frame.t === 'llm-error'));
			releaseGate();
			const frames = await completed;
			expect(String(frames.find(frame => frame.t === 'llm-error')?.message)).toContain('Recovered responses');
			expect(frames.some(frame => frame.t === 'sync' && (frame as any).scope === 'messages')).toBe(true);
			const saved = await rpc('getRecoveredGenerations', [chatId]) as any[];
			expect(saved).toHaveLength(1); expect(saved[0].payload.content).toBe('Hello world.');
			expect((await rpc('getMessagesByChat', [chatId]) as any[]).map(message => message.content)).toEqual(['Changed during generation']);
			await rpc('discardRecoveredGeneration', [chatId, saved[0].id]);
			expect(await rpc('getRecoveredGenerations', [chatId])).toEqual([]);
		} finally { socket.close(); }
	}, 30_000);

	test('the tokens written while nobody was listening are handed to the page that comes back', async () => {
		const id = crypto.randomUUID();
		armGate();
		const first = await openSocket();

		// Watch until the model has said everything it will say before the cut.
		const early = collect(first, (frames) => {
			const content = frames.filter((f) => f.t === 'llm-token').map((f) => String(f.token)).join('');
			return content === TOKENS_BEFORE_CUT.join('');
		});
		first.send(generateRequest(id));
		const seen = await early;
		const haveContent = seen
			.filter((f) => f.t === 'llm-token')
			.map((f) => String(f.token))
			.join('').length;
		expect(haveContent).toBe(TOKENS_BEFORE_CUT.join('').length);

		// The phone goes away mid-reply. Only once the socket is gone does the model write the
		// rest, so every token after this point is produced with nothing attached to send it to.
		first.close();
		await Bun.sleep(150);
		releaseGate();
		await Bun.sleep(300);

		const second = await openSocket();
		const claimed = collect(second, (frames) => frames.some((f) => f.t === 'llm-done'));
		second.send(JSON.stringify({ t: 'llm-attach', id, haveContent, haveThinking: 0 }));
		const frames = await claimed;

		const attached = frames.find((f) => f.t === 'llm-attached');
		expect(attached).toBeDefined();
		// The remainder alone: a claim that repainted from the start would duplicate the text
		// already on screen in the page that never reloaded.
		expect(attached?.content).toBe(TOKENS_AFTER_CUT.join(''));

		const result = frames.find((f) => f.t === 'llm-done')?.result as { content: string; finishReason: string };
		expect(result.content).toBe([...TOKENS_BEFORE_CUT, ...TOKENS_AFTER_CUT].join(''));
		expect(result.finishReason).toBe('stop');
		second.close();
	}, 30_000);

	test('the reply lands in the story even though no page was ever there to write it', async () => {
		const { chatId, userTurnId } = await seedChat();
		armGate();

		const socket = await openSocket();
		const early = collect(socket, (frames) => frames.some((f) => f.t === 'llm-token'));
		socket.send(
			generateRequest(crypto.randomUUID(), {
				chatId,
				placement: await rpc('getConversationPlacement', [chatId, 'append']),
				parentId: userTurnId,
				expectedLeafId: userTurnId,
				claimsRoot: false,
				lorebook: null,
				spendSteeringIds: []
			})
		);
		await early;

		// The page is gone for good: no reload, no second socket, nobody to claim anything.
		// Everything from here on is the server finishing a turn on its own.
		socket.close();
		await Bun.sleep(150);
		releaseGate();
		await Bun.sleep(500);

		const messages = (await rpc('getMessagesByChat', [chatId])) as {
			role: string;
			content: string;
			parentId: string | null;
			generationMs: number | null;
		}[];
		const reply = messages.find((m) => m.role === 'assistant');
		expect(reply).toBeDefined();
		expect(reply?.content).toBe([...TOKENS_BEFORE_CUT, ...TOKENS_AFTER_CUT].join(''));
		expect(reply?.parentId).toBe(userTurnId);
		// Clocked by the side that saw the frames, so a turn nobody watched still reports how
		// long it took.
		expect(reply?.generationMs).toBeGreaterThan(0);
	}, 30_000);

	test('a second reply for the same chat is refused while the first is still being written', async () => {
		const { chatId, userTurnId } = await seedChat();
		armGate();
		const placement = {
			chatId,
			placement: await rpc('getConversationPlacement', [chatId, 'append']),
			parentId: userTurnId,
			expectedLeafId: userTurnId,
			claimsRoot: false,
			lorebook: null,
			spendSteeringIds: []
		};

		const socket = await openSocket();
		const first = collect(socket, (frames) => frames.some((f) => f.t === 'llm-token'));
		socket.send(generateRequest(crypto.randomUUID(), placement));
		await first;

		// A page that could not see the running turn (its own was discarded) sends again.
		const secondId = crypto.randomUUID();
		const refusal = collect(socket, (frames) => frames.some((f) => f.t === 'llm-error' && f.id === secondId));
		socket.send(generateRequest(secondId, placement));
		expect(String((await refusal).find((f) => f.t === 'llm-error')?.message)).toMatch(/already being written/);

		releaseGate();
		await Bun.sleep(400);
		const messages = (await rpc('getMessagesByChat', [chatId])) as { role: string }[];
		expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
		socket.close();
	}, 30_000);

	// The refusal above is a dead end unless the page that meets it can reach the reply it is
	// being refused for. A reload leaves that page with no record of the request it started,
	// so this is the whole way back: ask what is running for the chat, and stop it by the id
	// that comes back. Every step here runs on a socket that never issued the generation.
	test('a page that lost its generation can find it by chat and stop it', async () => {
		const { chatId, userTurnId } = await seedChat();
		armGate();
		const placement = {
			chatId,
			placement: await rpc('getConversationPlacement', [chatId, 'append']),
			parentId: userTurnId,
			expectedLeafId: userTurnId,
			claimsRoot: false,
			lorebook: null,
			spendSteeringIds: []
		};

		const starter = await openSocket();
		const started = collect(starter, (frames) => frames.some((f) => f.t === 'llm-token'));
		starter.send(generateRequest(crypto.randomUUID(), placement));
		await started;
		// The page that asked for it is gone, exactly as a discarded tab leaves it.
		starter.close();
		await Bun.sleep(150);

		const returning = await openSocket();
		const statusId = crypto.randomUUID();
		const answered = collect(returning, (f) => f.some((frame) => frame.t === 'llm-status-result'));
		returning.send(JSON.stringify({ t: 'llm-status', id: statusId, chatIds: [chatId] }));
		const running = (await answered).find((f) => f.t === 'llm-status-result')?.running as {
			chatId: string;
			requestId: string;
			runningMs: number;
		}[];
		expect(running).toHaveLength(1);
		expect(running[0].chatId).toBe(chatId);
		expect(running[0].runningMs).toBeGreaterThanOrEqual(0);

		returning.send(JSON.stringify({ t: 'llm-cancel', id: running[0].requestId }));
		await Bun.sleep(200);

		// Stopped before the gate ever opened: the endpoint still holds the rest of its answer,
		// so nothing but the cancel can have ended this.
		const after = collect(returning, (f) => f.some((frame) => frame.t === 'llm-status-result'));
		returning.send(JSON.stringify({ t: 'llm-status', id: crypto.randomUUID(), chatIds: [chatId] }));
		expect((await after).find((f) => f.t === 'llm-status-result')?.running).toEqual([]);

		// And the chat is free again: the send that was refused a moment ago now goes through.
		const second = collect(returning, (f) => f.some((frame) => frame.t === 'llm-token'));
		returning.send(generateRequest(crypto.randomUUID(), { ...placement,
			placement: await rpc('getConversationPlacement', [chatId, 'replace_variants']) }));
		await second;

		releaseGate();
		await Bun.sleep(400);
		returning.close();
	}, 30_000);

	// An engine call (memory, a sprite label) writes no turn, holds nothing, and has its own
	// surfaces. Reporting it would put a "reply is being written" line over a chat that is
	// free to send. The gate is armed so the call is genuinely IN FLIGHT when the question is
	// asked: a settled generation is filtered out for a second reason, which would leave this
	// green whatever the rule under test did.
	test('a call that writes no turn is not reported as a reply being written', async () => {
		const { chatId } = await seedChat();
		armGate();
		const socket = await openSocket();
		const run = collect(socket, (f) => f.some((frame) => frame.t === 'llm-token'));
		socket.send(generateRequest(crypto.randomUUID()));
		await run;

		const answered = collect(socket, (f) => f.some((frame) => frame.t === 'llm-status-result'));
		socket.send(JSON.stringify({ t: 'llm-status', id: crypto.randomUUID(), chatIds: [chatId] }));
		expect((await answered).find((f) => f.t === 'llm-status-result')?.running).toEqual([]);

		releaseGate();
		await Bun.sleep(200);
		socket.close();
	}, 30_000);

	// A frame with no id correlates with nothing, so it must be dropped rather than answered:
	// an answer whose `id` key is missing reaches the client's pending map as `undefined`,
	// matches no entry, and leaves the real pending it was meant for waiting forever.
	test('a status request with no id is dropped, not answered', async () => {
		const { chatId } = await seedChat();
		const socket = await openSocket();
		const good = crypto.randomUUID();
		const answered = collect(socket, (f) => f.some((frame) => frame.t === 'llm-status-result'));
		socket.send(JSON.stringify({ t: 'llm-status', chatIds: [chatId] }));
		socket.send(JSON.stringify({ t: 'llm-status', id: good, chatIds: [chatId] }));
		const results = (await answered).filter((f) => f.t === 'llm-status-result');
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(good);
		socket.close();
	}, 15_000);

	test('a claim on a generation the server never had is answered, not left hanging', async () => {
		const socket = await openSocket();
		const frames = collect(socket, (f) => f.some((frame) => frame.t === 'llm-attach-miss'));
		socket.send(JSON.stringify({ t: 'llm-attach', id: 'never-existed', haveContent: 0, haveThinking: 0 }));
		expect((await frames)[0]?.t).toBe('llm-attach-miss');
		socket.close();
	}, 15_000);

	test('a released generation is forgotten, so its id cannot be claimed twice', async () => {
		const id = crypto.randomUUID();
		const socket = await openSocket();
		const run = collect(socket, (f) => f.some((frame) => frame.t === 'llm-done'));
		socket.send(generateRequest(id));
		await run;

		socket.send(JSON.stringify({ t: 'llm-release', id }));
		await Bun.sleep(100);

		const claim = collect(socket, (f) => f.some((frame) => frame.t === 'llm-attach-miss'));
		socket.send(JSON.stringify({ t: 'llm-attach', id, haveContent: 0, haveThinking: 0 }));
		expect((await claim)[0]?.t).toBe('llm-attach-miss');
		socket.close();
	}, 30_000);
});
