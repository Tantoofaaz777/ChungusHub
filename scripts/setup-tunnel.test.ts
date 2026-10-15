import { afterEach, beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, 'setup-tunnel.ts');
const lockModule = resolve(import.meta.dir, '../server/instance-lock.ts');
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'chungus-tunnel-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function run(domain: string, overrides: Record<string, string> = {}, mode = '--access', password?: string) {
	const env = { ...process.env };
	for (const key of ['CHUNGUS_DATA_DIR', 'CHUNGUS_PORT', 'CHUNGUS_HOST']) delete env[key];
	return Bun.spawnSync([process.execPath, script, domain, ...(mode ? [mode] : [])], {
		cwd: root, env: { ...env, ...overrides }, stdout: 'pipe', stderr: 'pipe',
		stdin: password === undefined ? 'ignore' : Buffer.from(password)
	});
}

test('a fresh setup remains on loopback and prints the tunnel destination', () => {
	const result = run('https://CHUNGUS.example.com/');
	expect(result.exitCode).toBe(0);
	expect(read(join(root, 'chungushub.config.json'))).toMatchObject({
		host: '127.0.0.1', port: 4242, openBrowser: false,
		allowedHostnames: ['chungus.example.com']
	});
	expect(read(join(root, 'user-data/security.json'))).toEqual({
		networkAccessEnabled: false, ipAllowlistEnabled: false
	});
	expect(result.stdout.toString()).toContain('http://127.0.0.1:4242');
	expect(result.stdout.toString()).toContain('Protect with Access');
});

test('existing data paths, password, sessions and first backups survive repeated setup', () => {
	const config = { port: 6060, dataDir: 'stories', backupDir: '../snapshots', allowedHostnames: ['old.example.com'], '//': 'keep this' };
	const security = { networkAccessEnabled: true, ipAllowlistEnabled: true, passwordEnabled: true,
		passwordHash: 'existing-hash', sessions: { token: 123 }, sessionIdleMinutes: 20 };
	const configPath = join(root, 'chungushub.config.json');
	const securityPath = join(root, 'stories/security.json');
	mkdirSync(join(root, 'stories'));
	write(configPath, config);
	write(securityPath, security);
	expect(run('chungus.example.com').exitCode).toBe(0);
	expect(run('chungus.example.com').exitCode).toBe(0);
	expect(read(configPath)).toMatchObject({ ...config, host: '127.0.0.1', openBrowser: false,
		allowedHostnames: ['old.example.com', 'chungus.example.com'] });
	expect(read(securityPath)).toEqual({ ...security, networkAccessEnabled: false, ipAllowlistEnabled: false });
	expect(read(`${configPath}.before-tunnel`)).toEqual(config);
	expect(read(`${securityPath}.before-tunnel`)).toEqual(security);
});

test('bad input or unreadable security settings never rewrites the config', () => {
	const path = join(root, 'chungushub.config.json');
	const original = '{"port":4242}';
	writeFileSync(path, original);
	expect(run('https://chungus.example.com/wrong-path').exitCode).toBe(1);
	expect(readFileSync(path, 'utf8')).toBe(original);
	mkdirSync(join(root, 'user-data'));
	writeFileSync(join(root, 'user-data/security.json'), 'broken');
	expect(run('chungus.example.com').exitCode).toBe(1);
	expect(readFileSync(path, 'utf8')).toBe(original);
	expect(existsSync(`${path}.before-tunnel`)).toBe(false);
});

test('environment data and port overrides match the server and unsafe host overrides refuse setup', () => {
	const data = join(root, 'external-data');
	expect(run('chungus.example.com', { CHUNGUS_DATA_DIR: data, CHUNGUS_PORT: '8080' }).exitCode).toBe(0);
	expect(read(join(data, 'security.json')).ipAllowlistEnabled).toBe(false);
	expect(read(join(root, 'chungushub.config.json')).port).toBe(8080);
	expect(existsSync(join(root, 'user-data'))).toBe(false);
	expect(run('chungus.example.com', { CHUNGUS_HOST: '0.0.0.0' }).exitCode).toBe(1);
});

test('password setup accepts seven characters, hashes stdin and never prints the password', () => {
	const password = 'senha ç';
	const result = run('chungus.example.com', {}, '--password-stdin', `${password}\n`);
	expect(result.exitCode).toBe(0);
	const path = join(root, 'user-data/security.json');
	const security = read(path);
	expect(security.passwordEnabled).toBe(true);
	expect(Bun.password.verifySync(password, security.passwordHash)).toBe(true);
	expect(security.sessions).toEqual({});
	expect(result.stdout.toString() + result.stderr.toString() + readFileSync(path, 'utf8')).not.toContain(password);
	// Reuse the password without requiring a terminal, including after a lock was disabled.
	write(path, { ...security, passwordEnabled: false, sessions: { existing: 123 } });
	expect(run('chungus.example.com', {}, '').exitCode).toBe(0);
	expect(read(path)).toMatchObject({ passwordEnabled: true, passwordHash: security.passwordHash, sessions: { existing: 123 } });
	// A replacement invalidates the old sessions and old password.
	expect(run('chungus.example.com', {}, '--password-stdin', 'replacement password').exitCode).toBe(0);
	expect(read(path).sessions).toEqual({});
	expect(Bun.password.verifySync(password, read(path).passwordHash)).toBe(false);
});

test('a missing or short password cannot silently configure an unprotected origin', () => {
	for (const [mode, password] of [['', undefined], ['--password-stdin', '123456']] as const) {
		expect(run('chungus.example.com', {}, mode, password).exitCode).toBe(1);
		expect(existsSync(join(root, 'chungushub.config.json'))).toBe(false);
		expect(existsSync(join(root, 'user-data/security.json'))).toBe(false);
	}
});

test('a running instance prevents edits to the configuration and security switches', async () => {
	const data = join(root, 'user-data');
	mkdirSync(data);
	const securityPath = join(data, 'security.json');
	write(securityPath, { ipAllowlistEnabled: true });
	const child = Bun.spawn([process.execPath, '-e',
		`import { claimDataDir } from ${JSON.stringify(lockModule)}; await claimDataDir(${JSON.stringify(data)}, () => ({pid: process.pid, port: 4242, startedAt: Date.now()})); console.log('ready');`],
		{ stdout: 'pipe', stderr: 'pipe' });
	try {
		const reader = child.stdout.getReader();
		const ready = await reader.read();
		expect(new TextDecoder().decode(ready.value)).toContain('ready');
		const env = { ...process.env };
		for (const key of ['CHUNGUS_DATA_DIR', 'CHUNGUS_PORT', 'CHUNGUS_HOST']) delete env[key];
		const setup = Bun.spawn([process.execPath, script, 'chungus.example.com'], {
			cwd: root, env, stdout: 'pipe', stderr: 'pipe'
		});
		expect(await setup.exited).toBe(1);
		expect(await new Response(setup.stderr).text()).toContain('Stop ChungusHub');
		expect(read(securityPath).ipAllowlistEnabled).toBe(true);
		expect(existsSync(join(root, 'chungushub.config.json'))).toBe(false);
	} finally {
		child.kill();
		await child.exited;
	}
}, 15000);
