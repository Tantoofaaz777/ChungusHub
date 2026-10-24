import { afterEach, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { removeDatabaseFixture } from '../server/test-fixtures';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeDatabaseFixture(root, 'chungus-updater-'); });

function fixture() {
	const outer = mkdtempSync(join(tmpdir(), 'chungus-updater-')); roots.push(outer);
	const root = join(outer, 'repo with spaces');
	for (const dir of ['scripts', 'fakebin', 'runtime/bin', 'host/usr/local/bin', 'host/etc/systemd/system/chungushub.service.d']) mkdirSync(join(root, dir), { recursive: true });
	for (const name of ['setup-updater.sh', 'chungus-update.sh']) copyFileSync(resolve('scripts', name), join(root, 'scripts', name));
	writeFileSync(join(root, 'host/usr/local/bin/chungus-update'), 'original updater');
	writeFileSync(join(root, 'host/etc/systemd/system/chungushub.service.d/zz-chungus-runtime.conf'), 'original override');
	const put = (name: string, body: string) => writeFileSync(join(root, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
	put('scripts/ensure-bun.sh', `echo ensure >> "$CHUNGUS_TEST_FIXTURE/trace"
[[ "$CHUNGUS_TEST_MODE" != bootstrap-failure ]] || exit 19
printf '%s\\n' "$CHUNGUS_TEST_FIXTURE/runtime/bin/bun"`);
	put('runtime/bin/bun', `echo "bun:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
case "$1" in
    install) [[ "$CHUNGUS_TEST_MODE" != install-failure ]] || exit 23 ;;
    run) [[ "$CHUNGUS_TEST_MODE" != build-failure ]] || exit 24 ;;
    -e) printf '%s\\n' "$CHUNGUS_SERVICE_PORT" ;;
esac`);
	put('fakebin/git', `echo "git:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
[[ "$CHUNGUS_TEST_MODE" != git-failure ]]`);
	put('fakebin/systemctl', `echo "systemctl:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
case "$*" in
    *property=User*) echo test-owner ;;
    *property=WorkingDirectory*) printf '%s\\n' "$CHUNGUS_TEST_FIXTURE" ;;
    *property=Environment*) echo 'CHUNGUS_PORT=6060' ;;
    *property=ExecStart*)
        if [[ "$CHUNGUS_TEST_MODE" == wrong-service ]]; then echo '{ path=/old/bun ; }'
        else printf '{ path=%s/runtime/bin/bun ; argv[]=bun server/index.ts ; }\\n' "$CHUNGUS_TEST_FIXTURE"; fi ;;
esac`);
	put('fakebin/curl', `echo "curl:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
[[ "$CHUNGUS_TEST_MODE" != health-failure ]]`);
	put('fakebin/uname', 'echo Linux');
	put('fakebin/id', 'echo test-owner');
	put('fakebin/systemd-analyze', `echo "verify:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
[[ "$CHUNGUS_TEST_MODE" != invalid-unit ]]`);
	// Never let a setup test write to the host's /etc or /usr/local.
	put('fakebin/sudo', `echo "sudo:$*" >> "$CHUNGUS_TEST_FIXTURE/trace"
case "$1" in
    mkdir) /bin/mkdir -p "$CHUNGUS_TEST_FIXTURE/host$3" ;;
    test) /usr/bin/test "$2" "$CHUNGUS_TEST_FIXTURE/host$3" ;;
    cp) /bin/cp -a "$CHUNGUS_TEST_FIXTURE/host$3" "$CHUNGUS_TEST_FIXTURE/host$4" ;;
    install) /usr/bin/install "$2" "$3" "$4" "$CHUNGUS_TEST_FIXTURE/host$5" ;;
    systemctl) shift; exec systemctl "$@" ;;
    *) echo 'Unexpected sudo command in test' >&2; exit 99 ;;
esac`);
	writeFileSync(join(root, 'driver.sh'), `#!/usr/bin/env bash
set -eu
fixture=$(cd "$1" && pwd)
export CHUNGUS_TEST_FIXTURE="$fixture" CHUNGUS_TEST_MODE="$2"
export PATH="$fixture/fakebin:/usr/bin:/bin"
cd "$fixture"
exec bash "$fixture/scripts/$3"
`);
	return root;
}

async function run(root: string, mode = 'normal', setup = false) {
	const child = Bun.spawn([bash, join(root, 'driver.sh'), root, mode, setup ? 'setup-updater.sh' : 'chungus-update.sh'], { stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	return { code, stdout, stderr, trace: readFileSync(join(root, 'trace'), 'utf8') };
}

test('updater provisions before installing/building and restarts only after success, with local authenticated-server health check', async () => {
	const result = await run(fixture());
	expect(result).toMatchObject({ code: 0 });
	expect(result.trace.indexOf('ensure')).toBeLessThan(result.trace.indexOf('bun:install'));
	expect(result.trace.indexOf('bun:run build')).toBeLessThan(result.trace.indexOf('systemctl:restart'));
	expect(result.trace).toContain('http://127.0.0.1:6060/api/health');
	expect(result.trace).not.toContain('Host:');
	expect(result.stdout).toContain('Updated and running');
}, 30000);

for (const mode of ['git-failure', 'bootstrap-failure', 'install-failure', 'build-failure', 'wrong-service']) {
	test(`${mode} never restarts the existing service or reports success`, async () => {
		const result = await run(fixture(), mode);
		expect(result.code).not.toBe(0);
		expect(result.trace).not.toContain('systemctl:restart');
		expect(result.stdout).not.toContain('Updated and running');
	}, 30000);
}

test('failed post-restart health check is reported rather than claiming success', async () => {
	const result = await run(fixture(), 'health-failure');
	expect(result.code).not.toBe(0);
	expect(result.trace).toContain('systemctl:restart');
	expect(result.stdout).not.toContain('Updated and running');
}, 30000);

test('one-time setup preserves original files, writes quoted stable paths and does not restart', async () => {
	const root = fixture();
	const result = await run(root, 'normal', true);
	expect(result).toMatchObject({ code: 0 });
	const base = join(root, 'host/etc/systemd/system/chungushub.service.d/zz-chungus-runtime.conf');
	expect(readFileSync(`${base}.before-managed-runtime`, 'utf8')).toBe('original override');
	expect(readFileSync(join(root, 'host/usr/local/bin/chungus-update.before-managed-runtime'), 'utf8')).toBe('original updater');
	const dropin = readFileSync(base, 'utf8');
	expect(dropin).toContain('ExecStart=\nExecStart="');
	expect(dropin).toContain('runtime/bin/bun" server/index.ts');
	expect(dropin).toMatch(/^WorkingDirectory=\/.*\/repo with spaces$/m);
	expect(dropin).not.toContain('WorkingDirectory="');
	expect(result.trace.indexOf('verify:')).toBeLessThan(result.trace.indexOf('sudo:install'));
	expect(result.trace).toContain('systemctl:daemon-reload');
	expect(result.trace).not.toContain('systemctl:restart');
	expect(existsSync(join(root, 'host/usr/local/bin/chungus-update'))).toBe(true);
	const repeated = await run(root, 'normal', true);
	expect(repeated.code).toBe(0);
	expect(readFileSync(`${base}.before-managed-runtime`, 'utf8')).toBe('original override');
}, 30000);

test('native systemd validation failure leaves configuration and updater untouched', async () => {
	const root = fixture();
	const result = await run(root, 'invalid-unit', true);
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain('failed validation');
	expect(result.trace).not.toContain('sudo:install');
	expect(result.trace).not.toContain('systemctl:daemon-reload');
	expect(readFileSync(join(root, 'host/usr/local/bin/chungus-update'), 'utf8')).toBe('original updater');
	expect(readFileSync(join(root, 'host/etc/systemd/system/chungushub.service.d/zz-chungus-runtime.conf'), 'utf8')).toBe('original override');
}, 30000);

// Mocks check orchestration above; Linux CI also asks the real unit parser to
// accept the generated drop-in and reject the exact quoting regression.
if (process.platform === 'linux' && Bun.which('systemd-analyze')) {
	test('real systemd accepts generated paths with spaces and rejects quoted WorkingDirectory', async () => {
		const root = fixture();
		expect(await run(root, 'normal', true)).toMatchObject({ code: 0 });
		const dropin = readFileSync(join(root, 'host/etc/systemd/system/chungushub.service.d/zz-chungus-runtime.conf'), 'utf8');
		const unit = join(root, 'syntax-check.service');
		const prefix = '[Unit]\nDefaultDependencies=no\n';
		writeFileSync(unit, prefix + dropin);
		const good = Bun.spawnSync(['systemd-analyze', 'verify', '--man=no', unit]);
		expect({ code: good.exitCode, stderr: good.stderr.toString() }).toMatchObject({ code: 0 });
		writeFileSync(unit, prefix + dropin.replace(/^WorkingDirectory=(.*)$/m, 'WorkingDirectory="$1"'));
		const bad = Bun.spawnSync(['systemd-analyze', 'verify', '--man=no', unit]);
		expect(bad.exitCode).not.toBe(0);
		expect(bad.stderr.toString()).toMatch(/WorkingDirectory|working directory/i);
	}, 30000);
}
