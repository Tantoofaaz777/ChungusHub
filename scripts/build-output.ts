import { stripVTControlCharacters } from 'node:util';
import type { Logger } from 'vite';

/** Hide only Vite's generated-file size table; leave diagnostics and progress intact. */
export function compactBuildLogger(logger: Logger): Logger {
	const info = logger.info.bind(logger);
	logger.info = (message, options) => {
		const remaining = message.split('\n').filter(line => {
			const plain = stripVTControlCharacters(line).replaceAll('\\', '/');
			return !/^\s*\.svelte-kit\/output\/(?:client|server)\/.*\s+\d[\d,]*(?:\.\d+)? kB(?:\s*│.*)?\s*$/.test(plain);
		}).join('\n');
		if (remaining.trim()) info(remaining, options);
	};
	return logger;
}
