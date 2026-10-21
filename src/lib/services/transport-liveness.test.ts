import { beforeAll, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute the real transport in an isolated browser with a deterministic clock/socket.
// No singleton state leaks into other suites and no real server or user data is touched.
let source: string;
beforeAll(async () => {
	const build = await Bun.build({ entrypoints: [fileURLToPath(new URL('./transport.ts', import.meta.url))],
		target: 'browser', format: 'cjs', write: false, define: { 'import.meta.env.DEV': 'false' } });
	if (!build.success) throw new Error(build.logs.join('\n'));
	source = await build.outputs[0].text();
});

function harness() {
	let now = 100, nextTimer = 0, nextUuid = 0;
	const timers = new Map<number, { at: number; run: () => void }>();
	function eventTarget(extra: Record<string, unknown> = {}) {
		const listeners = new Map<string, (() => void)[]>();
		return { ...extra, addEventListener(type: string, run: () => void) {
			listeners.set(type, [...listeners.get(type) ?? [], run]);
		}, dispatch(type: string) { for (const run of listeners.get(type) ?? []) run(); } };
	}
	const document = eventTarget({ visibilityState: 'visible' });
	const window = eventTarget({ ChungusAndroidClient: { foreground: true } });
	const sockets: Socket[] = [];
	class Socket {
		static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
		readyState = Socket.CONNECTING;
		sent: any[] = [];
		closed: { code?: number; reason?: string }[] = [];
		onopen?: () => void; onclose?: () => void; onerror?: () => void;
		onmessage?: (event: { data: string }) => void;
		constructor(public url: string) { sockets.push(this); }
		open() { this.readyState = Socket.OPEN; this.onopen?.(); }
		send(raw: string) { if (this.readyState !== Socket.OPEN) throw new Error('Socket is closed'); this.sent.push(JSON.parse(raw)); }
		close(code?: number, reason?: string) { this.closed.push({ code, reason }); this.readyState = Socket.CLOSED; this.onclose?.(); }
		message(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
	}
	const module = { exports: {} as typeof import('./transport') };
	runInNewContext(source, { module, exports: module.exports, window, document, WebSocket: Socket,
		location: { protocol: 'https:', host: 'chungus.test', hostname: 'chungus.test' },
		crypto: { randomUUID: () => `request-${++nextUuid}` }, performance: { now: () => now }, console,
		setTimeout(run: () => void, delay = 0) { const id = ++nextTimer; timers.set(id, { at: now + delay, run }); return id; },
		clearTimeout(id: number) { timers.delete(id); } });
	const transport = module.exports;
	function tick(ms: number) {
		const until = now + ms;
		let callbacks = 0;
		for (;;) {
			const next = [...timers.entries()].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
			if (!next) break;
			if (++callbacks > 10000) throw new Error('Timer loop did not settle');
			timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].run();
		}
		now = until;
	}
	return { transport, sockets, tick,
		freeze(ms: number) { now += ms; },
		callbacks: () => [...timers.values()].map(task => task.run),
		visible(value: boolean) { document.visibilityState = value ? 'visible' : 'hidden'; document.dispatch('visibilitychange'); },
		nativeForeground(value: boolean) {
			window.ChungusAndroidClient.foreground = value;
			window.dispatch('chungus-android-lifecycle');
		},
		pageshow() { window.dispatch('pageshow'); },
		async connect() { const opening = transport.connectWs(); const socket = sockets.at(-1)!; socket.open(); await opening; return socket; }
	};
}

function measure(h: ReturnType<typeof harness>, socket: ReturnType<typeof harness>['sockets'][number]) {
	h.tick(300); h.tick(10); socket.message({ t: 'pong' });
}

test('backgrounding clears an unanswered probe without closing the socket or polling', async () => {
	const h = harness(), socket = await h.connect();
	h.tick(300);
	const sent = socket.sent.length, queued = h.callbacks();
	h.visible(false);
	for (const callback of queued) callback(); // Already-queued tasks can survive clearTimeout.
	h.tick(120000);
	expect(socket.sent).toHaveLength(sent);
	expect(socket.closed).toHaveLength(0);
	expect(h.transport.isReachable()).toBe(true);
});

test('resuming a healthy socket probes immediately with a fresh answer window', async () => {
	const h = harness(), socket = await h.connect();
	measure(h, socket);
	h.tick(5990); // The first unanswered adaptive probe has already used one strike.
	h.visible(false);
	h.tick(60000);
	const before = socket.sent.length;
	h.visible(true);
	expect(socket.sent).toHaveLength(before + 1);
	expect(socket.sent.at(-1).t).toBe('ping');
	h.tick(5000); // The old 1s estimate and old strike must not survive backgrounding.
	expect(socket.closed).toHaveLength(0);
	socket.message({ t: 'pong' });
	expect(h.sockets).toHaveLength(1);
});

test('native lifecycle pauses liveness even before WebView changes document visibility', async () => {
	const h = harness(), socket = await h.connect();
	measure(h, socket);
	h.nativeForeground(false);
	const before = socket.sent.length;
	h.tick(120000);
	expect(socket.sent).toHaveLength(before);
	expect(socket.closed).toHaveLength(0);
	h.nativeForeground(true);
	expect(socket.sent.at(-1).t).toBe('ping');
	expect(socket.sent).toHaveLength(before + 1);
});

test('a closed background socket waits, then reconnects immediately on return', async () => {
	const h = harness(), socket = await h.connect();
	h.visible(false); socket.close(); h.tick(120000);
	expect(h.sockets).toHaveLength(1);
	h.visible(true);
	expect(h.sockets).toHaveLength(2);
	h.sockets[1].open();
	expect(h.transport.isReachable()).toBe(true);
});

test('returning cancels a pending retry instead of opening a duplicate connection', async () => {
	const h = harness(), socket = await h.connect();
	socket.close();
	h.pageshow();
	expect(h.sockets).toHaveLength(2);
	h.sockets[1].open();
	h.tick(2000);
	expect(h.sockets).toHaveLength(2);
});

test('an overdue answer timeout after a frozen renderer gets a fresh probe, not a strike', async () => {
	const h = harness(), socket = await h.connect();
	measure(h, socket);
	h.tick(5990); // One strike, with the second answer window outstanding.
	h.freeze(30000); h.tick(0);
	expect(socket.closed).toHaveLength(0);
	expect(socket.sent.at(-1).t).toBe('ping');
	h.tick(100); socket.message({ t: 'pong' });
	expect(h.sockets).toHaveLength(1);
});

test('a genuinely silent foreground server still times out after two probes', async () => {
	const h = harness(), socket = await h.connect();
	measure(h, socket);
	h.tick(5990);
	expect(socket.closed).toHaveLength(0);
	h.tick(2000);
	expect(socket.closed).toEqual([{ code: 4000, reason: 'Liveness probe timed out' }]);
});

test('an in-flight generation survives background disconnect and reattaches without a second request', async () => {
	const h = harness(), socket = await h.connect();
	const tokens: string[] = [];
	const result = h.transport.llmComplete({ connectionId: 'test', provider: 'test', model: 'test', messages: [],
		stream: true, deliverTokens: true, onToken: text => tokens.push(text) });
	for (let i = 0; i < 5; i++) await Promise.resolve();
	const request = socket.sent.find(frame => frame.t === 'llm');
	expect(request).toBeDefined();
	socket.message({ t: 'llm-token', id: request.id, token: 'Hello ' });
	h.visible(false);
	socket.readyState = 3; // The OS closed it, but its onclose callback is still frozen.
	h.tick(60000);
	h.visible(true);
	const next = h.sockets[1]; next.open();
	expect(next.sent.find(frame => frame.t === 'llm-attach')).toMatchObject({ id: request.id, haveContent: 6, haveThinking: 0 });
	next.message({ t: 'llm-attached', id: request.id, content: 'world', thinking: '' });
	next.message({ t: 'llm-done', id: request.id, result: { content: 'Hello world', thinking: null, finishReason: 'stop',
		model: 'test', provider: 'test', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } } });
	const completed = await result;
	expect(completed.content).toBe('Hello world');
	expect(completed.reattached).toBe(true);
	expect(completed.firstTokenMs).toBeNull();
	expect(tokens.join('')).toBe('Hello world');
	expect(h.sockets.flatMap(connection => connection.sent).filter(frame => frame.t === 'llm')).toHaveLength(1);
});

test('a queued timeout cannot overrule a pong that has already arrived', async () => {
	const h = harness(), socket = await h.connect();
	measure(h, socket);
	h.tick(5990);
	const queued = h.callbacks();
	socket.message({ t: 'pong' });
	for (const callback of queued) callback();
	expect(socket.closed).toHaveLength(0);
});
