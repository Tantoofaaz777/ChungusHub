import { unsupportedBunReason } from './runtime-version';

const reason = unsupportedBunReason(typeof Bun === 'undefined' ? undefined : Bun.version);
if (reason) {
	console.error(reason);
	process.exit(1);
}
