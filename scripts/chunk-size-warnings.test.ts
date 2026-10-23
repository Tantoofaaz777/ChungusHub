import { describe, expect, test } from 'bun:test';
import { oversizedChunks } from './chunk-size-warnings';

function chunk(code: string, ids: string[], fileName = 'test.js') {
	return { type: 'chunk', fileName, code, modules: Object.fromEntries(ids.map(id => [id, {}])) };
}
const cl = '/app/node_modules/gpt-tokenizer/esm/encoding/cl100k_base.js';
const o2 = '/app/node_modules/gpt-tokenizer/esm/encoding/o200k_base.js';

describe('client chunk size warnings', () => {
	test('expected lazy vocabularies are quiet while an oversized app chunk still warns', () => {
		const warnings = oversizedChunks({
			cl: chunk('x'.repeat(951230), [cl], 'cl.js'),
			o2: chunk('x'.repeat(2013608), [o2], 'o2.js'),
			app: chunk('x'.repeat(607452), ['/app/src/main.ts'], 'app.js')
		});
		expect(warnings).toEqual([{ fileName: 'app.js', sizeKB: 607.452, limitKB: 500, vocabulary: false }]);
	});
	test('unexpected vocabulary growth warns rather than getting an unlimited exemption', () => {
		expect(oversizedChunks({ cl: chunk('x'.repeat(1100001), [cl]) })[0]).toMatchObject({ limitKB: 1100, vocabulary: true });
		expect(oversizedChunks({ o2: chunk('x'.repeat(2300001), [o2]) })[0]).toMatchObject({ limitKB: 2300, vocabulary: true });
	});
	test('mixing app code or both encodings into a chunk keeps the 500 kB budget', () => {
		for (const ids of [[cl, '/app/src/main.ts'], [cl, o2], []]) {
			expect(oversizedChunks({ mixed: chunk('x'.repeat(600000), ids) })[0]).toMatchObject({ limitKB: 500, vocabulary: false });
		}
	});
	test('normalizes Windows paths and module queries without exempting similarly named app files', () => {
		expect(oversizedChunks({ cl: chunk('x'.repeat(950000), ['C:\\app\\node_modules\\gpt-tokenizer\\esm\\encoding\\cl100k_base.js?compiled']) })).toEqual([]);
		expect(oversizedChunks({ cl: chunk('x'.repeat(950000), ['/app/src/gpt-tokenizer/encoding/cl100k_base.js']) })[0].limitKB).toBe(500);
	});
	test('uses UTF-8 bytes, with the same decimal kB threshold as Vite, and ignores assets', () => {
		expect(oversizedChunks({ exact: chunk('x'.repeat(500000), []) })).toEqual([]);
		expect(oversizedChunks({ unicode: chunk('é'.repeat(250001), []) })[0].sizeKB).toBe(500.002);
		expect(oversizedChunks({ css: { type: 'asset', fileName: 'large.css', code: 'x'.repeat(900000) } })).toEqual([]);
	});
});
