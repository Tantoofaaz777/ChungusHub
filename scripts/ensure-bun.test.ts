import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ZipFile } from 'yazl';
import { removeDatabaseFixture } from '../server/test-fixtures';
import { MINIMUM_BUN_VERSION, unsupportedBunReason } from '../server/runtime-version';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeDatabaseFixture(root, 'chungus-bootstrap-'); });
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const powershell = process.platform === 'win32' ? `${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe` : '';

function archive(name: string, content: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const zip = new ZipFile(), chunks: Buffer[] = [];
		zip.outputStream.on('data', chunk => chunks.push(chunk));
		zip.outputStream.on('error', reject);
		zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
		zip.addBuffer(Buffer.from(content), name, { mode: 0o100755 });
		zip.end();
	});
}

type FixtureOptions = { windows?: boolean; target?: string; version?: string; systemVersion?: string; cachedVersion?: string; corruptArchive?: boolean };
async function fixture(options: FixtureOptions = {}) {
	const outer = mkdtempSync(join(tmpdir(), 'chungus-bootstrap-')); roots.push(outer);
	const root = join(outer, 'with spaces');
	for (const dir of ['scripts', 'fakebin', 'home']) mkdirSync(join(root, dir), { recursive: true });
	const target = options.target ?? (options.windows ? 'windows-x64' : 'linux-x64');
	const filename = `bun-${target}`;
	const body = options.windows ? options.version ?? '1.4.4' : `#!/usr/bin/env bash\nprintf '%s\\n' '${options.version ?? '1.4.4'}'\n`;
	const zip = options.corruptArchive ? Buffer.from('not a zip') : await archive(`${filename}/bun${options.windows ? '.exe' : ''}`, body);
	writeFileSync(join(root, 'download.zip'), zip);
	writeFileSync(join(root, 'scripts/bun-runtime.txt'), `minimum 1.4.4\nversion 1.4.4\n${target} ${filename}.zip ${createHash('sha256').update(zip).digest('hex')}\n`);
	copyFileSync(resolve(`scripts/ensure-bun.${options.windows ? 'ps1' : 'sh'}`), join(root, `scripts/ensure-bun.${options.windows ? 'ps1' : 'sh'}`));
	const cached = options.windows ? join(root, `cache/bun-1.4.4/${filename}/bun.exe`) : join(root, 'cache/bin/bun');
	if (options.cachedVersion) {
		mkdirSync(join(cached, '..'), { recursive: true });
		writeFileSync(cached, options.windows ? options.cachedVersion : `#!/usr/bin/env bash\necho '${options.cachedVersion}'\n`, { mode: 0o755 });
	}
	if (options.windows) {
		if (options.systemVersion) writeFileSync(join(root, 'system-bun'), options.systemVersion);
		writeFileSync(join(root, 'driver.ps1'), `
param([string]$Fixture, [string]$Mode, [switch]$ForceManaged)
. (Join-Path $Fixture 'scripts/ensure-bun.ps1')
function Get-ChungusBunVersion([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) { return [IO.File]::ReadAllText($Path).Trim() }
    return ''
}
function Find-ChungusSystemBun {
    $candidate = Join-Path $Fixture 'system-bun'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}
function Save-ChungusBunArchive([string]$Url, [string]$Path) {
    if ($Url -notmatch '^https://github[.]com/oven-sh/bun/releases/download/bun-v1[.]4[.]4/bun-windows-(x64|aarch64)[.]zip$') { throw 'Unexpected download URL' }
    [IO.File]::AppendAllText((Join-Path $Fixture 'downloads.log'), $Url + "\n")
    if ($Mode -eq 'network') { throw 'Simulated network failure' }
    if ($Mode -eq 'checksum') { [IO.File]::WriteAllText($Path, 'wrong bytes') }
    else { [IO.File]::Copy((Join-Path $Fixture 'download.zip'), $Path) }
}
try { Get-ChungusBun -RuntimeRoot (Join-Path $Fixture 'cache') -Managed:$ForceManaged }
catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`);
	} else {
		const put = (name: string, source: string) => writeFileSync(join(root, 'fakebin', name), `#!/usr/bin/env bash\n${source}\n`, { mode: 0o755 });
		put('uname', `if [[ "$1" == -s ]]; then echo '${target.startsWith('darwin') ? 'Darwin' : 'Linux'}'; else echo '${target.includes('aarch64') ? 'aarch64' : 'x86_64'}'; fi`);
		put('ldd', `echo '${target.endsWith('-musl') ? 'musl libc' : 'glibc'}'`);
		if (options.systemVersion) put('bun', `echo '${options.systemVersion}'`);
		put('curl', `set -e
output=''
while (($#)); do
    case "$1" in --output) output=$2; shift 2 ;; *) shift ;; esac
done
echo download >> "$CHUNGUS_TEST_FIXTURE/downloads.log"
case "$CHUNGUS_TEST_MODE" in
    network) echo 'Simulated network failure' >&2; exit 22 ;;
    checksum) printf 'wrong bytes' > "$output" ;;
    *) cp "$CHUNGUS_TEST_FIXTURE/download.zip" "$output" ;;
esac`);
		writeFileSync(join(root, 'driver.sh'), `#!/usr/bin/env bash
set -eu
fixture=$(cd "$1" && pwd)
export HOME="$fixture/home" PATH="$fixture/fakebin:/usr/bin:/bin"
export CHUNGUS_RUNTIME_DIR="$fixture/cache" CHUNGUS_TEST_FIXTURE="$fixture" CHUNGUS_TEST_MODE="$2"
shift 2
exec bash "$fixture/scripts/ensure-bun.sh" "$@"
`);
	}
	return { root, cached, target };
}

async function run(f: Awaited<ReturnType<typeof fixture>>, windows: boolean, mode = 'normal', managed = false) {
	const args = windows
		? [powershell, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(f.root, 'driver.ps1'), f.root, mode, ...(managed ? ['-ForceManaged'] : [])]
		: [bash, join(f.root, 'driver.sh'), f.root, mode, ...(managed ? ['--managed'] : [])];
	const env = { ...process.env, PROCESSOR_ARCHITECTURE: f.target.includes('aarch64') ? 'ARM64' : 'AMD64' };
	delete env.PROCESSOR_ARCHITEW6432;
	const child = Bun.spawn(args, { env, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	return { code, stdout: stdout.trim(), stderr };
}

for (const windows of process.platform === 'win32' ? [false, true] : [false]) {
	const label = windows ? 'PowerShell' : 'Bash';
	test(`${label} installs without Bun, handles spaces, then reuses the private runtime offline`, async () => {
		const f = await fixture({ windows });
		const first = await run(f, windows);
		expect(first).toMatchObject({ code: 0 });
		expect(existsSync(f.cached)).toBe(true);
		expect(first.stdout.replaceAll('\\', '/').toLowerCase()).toContain('/cache/');
		const second = await run(f, windows, 'network');
		expect(second.code).toBe(0);
		expect(second.stdout).toBe(first.stdout);
		expect(readFileSync(join(f.root, 'downloads.log'), 'utf8').trim().split('\n')).toHaveLength(1);
	}, 30000);

	test(`${label} reuses a newer system Bun without downloading or changing it`, async () => {
		const f = await fixture({ windows, systemVersion: '1.10.0' });
		expect(await run(f, windows, 'network')).toMatchObject({ code: 0 });
		expect(existsSync(join(f.root, 'downloads.log'))).toBe(false);
		expect(existsSync(f.cached)).toBe(false);
	}, 30000);

	test(`${label} keeps an old global Bun untouched and installs the private replacement`, async () => {
		const f = await fixture({ windows, systemVersion: '1.4.3' });
		expect(await run(f, windows)).toMatchObject({ code: 0 });
		expect(existsSync(f.cached)).toBe(true);
		const original = readFileSync(join(f.root, windows ? 'system-bun' : 'fakebin/bun'), 'utf8');
		expect(original).toContain('1.4.3');
	}, 30000);

	test(`${label} managed mode provisions a stable private location even with a newer global Bun`, async () => {
		const f = await fixture({ windows, systemVersion: '1.10.0' });
		expect(await run(f, windows, 'normal', true)).toMatchObject({ code: 0 });
		expect(existsSync(f.cached)).toBe(true);
	}, 30000);

	for (const mode of ['checksum', 'network', 'wrong-version', 'archive']) {
		test(`${label} ${mode} failure preserves the previous runtime and clears staging`, async () => {
			const f = await fixture({ windows, cachedVersion: '1.4.3', version: mode === 'wrong-version' ? '1.4.2' : undefined, corruptArchive: mode === 'archive' });
			const original = readFileSync(f.cached);
			const result = await run(f, windows, mode, true);
			expect(result.code).not.toBe(0);
			const expected = { checksum: 'checksum mismatch', network: 'Simulated network failure', 'wrong-version': 'unexpected version', archive: 'archive could not be read' }[mode]!;
			expect(result.stderr).toContain(expected);
			expect(readFileSync(f.cached)).toEqual(original);
			expect(readdirSync(join(f.root, 'cache'), { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('.install'))).toHaveLength(0);
		}, 30000);
	}
}

for (const target of ['linux-aarch64', 'linux-x64-musl', 'darwin-aarch64']) {
	test(`Bash selects the approved ${target} artifact`, async () => {
		const f = await fixture({ target });
		expect((await run(f, false)).code).toBe(0);
		expect(existsSync(f.cached)).toBe(true);
	}, 30000);
}

test('bootstrap manifest agrees with the runtime floor and CI pins, with complete pinned checksums', () => {
	const lines = readFileSync(resolve('scripts/bun-runtime.txt'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
	const rows = new Map(lines.map(l => { const [key, ...values] = l.split(/\s+/); return [key, values]; }));
	expect(rows.get('minimum')?.[0]).toBe(MINIMUM_BUN_VERSION);
	const version = rows.get('version')![0];
	expect(unsupportedBunReason(version)).toBeNull();
	for (const name of ['ci', 'release']) expect(readFileSync(resolve(`.github/workflows/${name}.yml`), 'utf8').match(/bun-version:\s*(\S+)/)?.[1]).toBe(version);
	expect(rows.size).toBe(10);
	for (const [key, values] of rows) if (!['minimum', 'version'].includes(key)) {
		expect(values[0]).toBe(`bun-${key}.zip`);
		expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
	}
});
