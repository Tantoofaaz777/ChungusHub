import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';

let dataDir: string;
let securityPath: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-security-'));
	securityPath = join(dataDir, 'security.json');
});

afterEach(() => removeDatabaseFixture(dataDir, 'chungus-security-'));

function startSecurity(script = ''): string {
	const result = Bun.spawnSync([process.execPath, '-e', `
		import * as security from './server/security.ts';
		security.initializeSecurity();
		${script}
	`], {
		cwd: resolve(import.meta.dir, '..'),
		env: { ...process.env, CHUNGUS_DATA_DIR: dataDir, NODE_ENV: 'test' },
		stdout: 'pipe', stderr: 'pipe'
	});
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return result.stdout.toString().trim();
}

const settings = () => JSON.parse(readFileSync(securityPath, 'utf8'));

test('a fresh install defaults to no inactivity limit', () => {
	startSecurity();
	expect(settings().sessionIdleMinutes).toBe(0);
});

test.each([60, undefined])('the old limit (%s) is removed without reviving expired sessions', (sessionIdleMinutes) => {
	const now = Date.now();
	const oldSettings = {
		passwordEnabled: true,
		passwordHash: 'existing-hash',
		networkAccessEnabled: false,
		ipAllowlistEnabled: false,
		sessionIdleMinutes,
		sessions: { a: now - 30 * 60_000, b: now - 90 * 60_000 }
	};
	writeFileSync(securityPath, JSON.stringify(oldSettings));
	startSecurity();
	expect(settings()).toMatchObject({
		...oldSettings,
		sessionIdleMinutes: 0,
		sessions: { a: oldSettings.sessions.a }
	});
	expect(settings().sessions).not.toHaveProperty('b');
	const result = startSecurity(`
		Date.now = () => ${now + 24 * 60 * 60_000};
		console.log(JSON.stringify([
			security.hasValidSession('chungus_session=a'),
			security.hasValidSession('chungus_session=b'),
			security.hasValidSession(null)
		]));
	`);
	expect(JSON.parse(result)).toEqual([true, false, false]);
});

test('an existing custom limit and a new choice of 60 survive startup', () => {
	writeFileSync(securityPath, JSON.stringify({ sessionIdleMinutes: 20 }));
	startSecurity();
	expect(settings().sessionIdleMinutes).toBe(20);
	startSecurity('security.setSessionIdleMinutes(60);');
	startSecurity();
	expect(settings().sessionIdleMinutes).toBe(60);
});
