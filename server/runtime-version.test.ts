import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MINIMUM_BUN_VERSION, unsupportedBunReason } from './runtime-version';
import { removeDatabaseFixture } from './test-fixtures';

test('runtime floor rejects affected, missing, malformed and prerelease versions', () => {
	for (const version of [undefined, '', '1.3.9', '1.4.3', '0.99.99', '1.4.4-canary', '1.5.0-beta.1', '1.04.4', '1.4', 'garbage']) {
		const reason = unsupportedBunReason(version);
		expect(reason).toContain(`requires stable Bun ${MINIMUM_BUN_VERSION}`);
		expect(reason).toContain('CVE-2026-111497');
		expect(reason).toContain('Portable servers must be rebuilt');
	}
});

test('runtime floor accepts the fixed release and compares newer versions numerically', () => {
	for (const version of ['1.4.4', '1.4.4+build.1', '1.4.10', '1.10.0', '2.0.0', '10.0.0']) {
		expect(unsupportedBunReason(version)).toBeNull();
	}
});

test('package metadata agrees with the enforced runtime floor', () => {
	const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	expect(metadata.engines.bun).toBe(`>=${MINIMUM_BUN_VERSION}`);
});

for (const entry of ['server/index.ts', 'scripts/package.ts']) {
	test(`${entry} refuses an old runtime before touching configuration, data or output`, async () => {
		const root = mkdtempSync(join(tmpdir(), 'chungus-runtime-'));
		try {
			// Exercise the actual entrypoint and its import order, including bundling for
			// portable builds. No production environment variable can bypass the guard.
			const built = await Bun.build({
				entrypoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
				target: 'bun',
				define: { 'Bun.version': JSON.stringify('1.4.3') }
			});
			expect(built.success).toBe(true);
			const bundle = join(root, 'entry.js');
			await Bun.write(bundle, built.outputs[0]);
			const child = Bun.spawn([process.execPath, bundle], {
				cwd: root,
				env: { ...process.env, NODE_ENV: 'production', CHUNGUS_PORT: '0', CHUNGUS_DATA_DIR: join(root, 'data'), CHUNGUS_BACKUP_DIR: join(root, 'backups'), CHUNGUS_NO_OPEN: '1' },
				timeout: 5000,
				stdout: 'pipe', stderr: 'pipe'
			});
			const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
			expect(code).toBe(1);
			expect(stdout).toBe('');
			expect(stderr).toContain('detected Bun 1.4.3');
			expect(stderr).toContain(`requires stable Bun ${MINIMUM_BUN_VERSION}`);
			expect(existsSync(join(root, 'data'))).toBe(false);
			expect(readdirSync(root)).toEqual(['entry.js']);
		} finally {
			removeDatabaseFixture(root, 'chungus-runtime-');
		}
	}, 30000);
}
