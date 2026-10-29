import { expect, test } from 'bun:test';
import type { Logger } from 'vite';
import { compactBuildLogger } from './build-output';

function capture() {
	const messages: { level: string; message: string; options: unknown }[] = [];
	const record = (level: string) => (message: string, options?: unknown) => {
		messages.push({ level, message, options });
	};
	const logger: Logger = {
		info: record('info'),
		warn: record('warn'),
		warnOnce: record('warnOnce'),
		error: record('error'),
		clearScreen() {},
		hasErrorLogged: () => false,
		hasWarned: false
	};
	return { logger: compactBuildLogger(logger), messages };
}

test('hides generated size rows on Unix and Windows, including colored gzip/map rows', () => {
	const { logger, messages } = capture();
	logger.info('.svelte-kit/output/server/chunks/chat.js  213.96 kB │ gzip: 65.03 kB │ map: 427.93 kB');
	logger.info('\u001b[32m.svelte-kit\\output\\client\\service-worker.js\u001b[0m  14.91 kB');
	logger.info('.svelte-kit/output/client/_app/immutable/assets/UI.woff2  24.00 kB');
	logger.info('.svelte-kit/output/client/_app/immutable/chunks/vocabulary.js  2,013.62 kB');
	expect(messages).toEqual([]);
});

test('preserves progress and other info even when combined with a size row', () => {
	const { logger, messages } = capture();
	const options = { environment: 'client' };
	logger.info('rendering chunks...\n.svelte-kit/output/client/app.js  12.00 kB\n✓ built in 6.87s', options);
	logger.info('Application size budget: 600.00 kB');
	expect(messages).toEqual([
		{ level: 'info', message: 'rendering chunks...\n✓ built in 6.87s', options },
		{ level: 'info', message: 'Application size budget: 600.00 kB', options: undefined }
	]);
});

test('never filters warnings or errors and retains logger state', () => {
	const { logger, messages } = capture();
	const message = '.svelte-kit/output/client/app.js  600.00 kB';
	const error = new Error('Build failed');
	logger.warn(message);
	logger.warnOnce('Deprecated API');
	logger.error(message, { error });
	logger.hasWarned = true;
	expect(messages).toEqual([
		{ level: 'warn', message, options: undefined },
		{ level: 'warnOnce', message: 'Deprecated API', options: undefined },
		{ level: 'error', message, options: { error } }
	]);
	expect(logger.hasWarned).toBe(true);
});
