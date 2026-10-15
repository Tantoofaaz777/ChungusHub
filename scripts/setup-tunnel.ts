/** Configure the local origin for an existing Cloudflare Tunnel, without starting the app. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { claimDataDir } from '../server/instance-lock';
import { hostnameEntry } from '../server/same-origin';

function readObject(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object. No settings were changed.`);
	}
	return value as Record<string, unknown>;
}

function writeObject(path: string, value: Record<string, unknown>): void {
	// The first pre-setup copy is retained even when setup is run again.
	if (existsSync(path) && !existsSync(`${path}.before-tunnel`)) {
		copyFileSync(path, `${path}.before-tunnel`);
	}
	const temp = `${path}.tunnel-${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	renameSync(temp, path);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
		console.log('Usage: bun run setup:tunnel chungus.example.com');
		console.log('Stop ChungusHub first. Protect this hostname with Cloudflare Access before publishing it.');
		return;
	}
	if (args.length !== 1) throw new Error('Usage: bun run setup:tunnel chungus.example.com');
	const input = args[0].trim();
	// Pasting the HTTPS address is accepted, but a path, credentials or port is not.
	const domain = hostnameEntry(input.replace(/^https:\/\//i, '').replace(/\/$/, ''));
	if (!domain) throw new Error('Use only the hostname, for example chungus.example.com.');

	const configPath = resolve('chungushub.config.json');
	const config = readObject(configPath);
	const dataDir = process.env.CHUNGUS_DATA_DIR
		? resolve(process.env.CHUNGUS_DATA_DIR)
		: resolve(dirname(configPath), String(config.dataDir ?? 'user-data'));
	if (config.dataDir !== undefined && (typeof config.dataDir !== 'string' || !config.dataDir.trim())) {
		throw new Error('Fix dataDir in chungushub.config.json first.');
	}
	const port = process.env.CHUNGUS_PORT !== undefined ? Number(process.env.CHUNGUS_PORT) : (config.port ?? 4242);
	if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error('The tunnel needs a fixed port between 1 and 65535.');
	}
	if (process.env.CHUNGUS_HOST && process.env.CHUNGUS_HOST !== '127.0.0.1') {
		throw new Error('Unset CHUNGUS_HOST or set it to 127.0.0.1 before using tunnel setup.');
	}
	if (config.allowedHostnames !== undefined &&
		(!Array.isArray(config.allowedHostnames) || config.allowedHostnames.some((name) => typeof name !== 'string' || !hostnameEntry(name)))) {
		throw new Error('Fix allowedHostnames in chungushub.config.json first.');
	}
	const securityPath = join(dataDir, 'security.json');
	const security = readObject(securityPath);
	// Use the app's own instance lock so a live server cannot race these edits or
	// observe the allowlist being disabled before its listening address is changed.
	mkdirSync(dataDir, { recursive: true });
	const holder = await claimDataDir(dataDir, () => ({ pid: process.pid, port: 0, startedAt: Date.now() }));
	if (holder) throw new Error('Stop ChungusHub before running tunnel setup. No settings were changed.');
	writeObject(configPath, {
		...config,
		port,
		host: '127.0.0.1',
		dataDir: config.dataDir ?? 'user-data',
		backupDir: config.backupDir ?? '../backups',
		openBrowser: false,
		allowedHostnames: [...new Set([...(config.allowedHostnames as string[] ?? []), domain])]
	});
	writeObject(securityPath, { ...security, networkAccessEnabled: false, ipAllowlistEnabled: false });
	console.log(`\nChungusHub is ready for https://${domain}`);
	console.log(`Local service: http://127.0.0.1:${port}`);
	console.log(`HTTP Host Header: ${domain}`);
	console.log('\nBefore publishing: create a Cloudflare Access application for this hostname,');
	console.log('allow only your email, and enable Protect with Access on the tunnel route.');
	console.log('Existing passwords and sessions were preserved. Access must protect the public route.');
	console.log('\nStart ChungusHub with: bun run start');
	console.log('Existing settings have a .before-tunnel backup beside each file.');
}

try {
	await main();
	process.exit(0); // Release the setup instance lock as well as its listening socket.
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
