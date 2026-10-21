import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';

/** Remove only the calling test's throwaway database directory. */
export function removeDatabaseFixture(dir: string, prefix: string): void {
	const absolute = resolve(dir);
	if (!prefix.startsWith('chungus-') || !absolute.startsWith(resolve(tmpdir()) + sep) ||
		!basename(absolute).startsWith(prefix)) throw new Error('Unsafe test data path');
	try {
		rmSync(absolute, { recursive: true, force: true });
	} catch (error) {
		// Bun 1.3.9 retains SQLite transaction handles after close(). Windows cannot
		// unlink those files until this process exits (see architecture/backups.md).
		// This is test teardown only: permission/path/IO errors must still fail.
		if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EBUSY') throw error;
		console.warn(`[test cleanup] Windows still holds the temporary SQLite database: ${absolute}`);
	}
}
