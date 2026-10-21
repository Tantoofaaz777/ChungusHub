import { describe, expect, test } from 'bun:test';
import { isDecorationColor, sanitizeDecorations } from './inline-decoration';

describe('what a preset may decorate', () => {
	test('existing colour, weight and alignment formatting survives', () => {
		expect(sanitizeDecorations('color:#3fa7c4')).toBe('color: #3fa7c4');
		expect(sanitizeDecorations('background-color: rgba(20,20,28,0.8)')).toBe(
			'background-color: rgba(20,20,28,0.8)'
		);
		expect(sanitizeDecorations('font-weight:bold')).toBe('font-weight: bold');
		expect(sanitizeDecorations('text-align: center')).toBe('text-align: center');
	});

	test('an imported panel header keeps validated typography, spacing and decoration', () => {
		const authored =
			'background:linear-gradient(90deg, #202433, #12141c);padding:12px 15px;' +
			'font-weight:bold;color:#dfe3ef;cursor:pointer;text-transform:uppercase;' +
			'letter-spacing:1px;list-style:none;border-bottom:2px solid #3fa7c4;border-radius:6px 6px 0 0;';
		expect(sanitizeDecorations(authored)).toBe(
			'background: linear-gradient(90deg, #202433, #12141c); padding: 12px 15px; ' +
			'font-weight: bold; color: #dfe3ef; text-transform: uppercase; ' +
			'letter-spacing: 1px; border-bottom: 2px solid #3fa7c4; border-radius: 6px 6px 0 0'
		);
	});

	// app.css reads this serialization back with attribute selectors, to decide that a
	// preset's colour outranks the app's own quote/strong/emphasis accents. It anchors on
	// the start of the attribute and on the `; ` between declarations, which is the only
	// thing keeping `background-color:` from being read as a text colour. Change the shape
	// here and coloured dialogue silently stops working.
	test('a surviving colour is serialized where the stylesheet can find it', () => {
		expect(sanitizeDecorations('color: #56b4e9')).toStartWith('color:');
		expect(sanitizeDecorations('background-color:#111;color:#56b4e9')).toBe(
			'background-color: #111; color: #56b4e9'
		);
		// The one shape that must NOT read as a text colour.
		expect(sanitizeDecorations('background-color:#111')).not.toStartWith('color:');
		expect(sanitizeDecorations('background-color:#111')).not.toInclude('; color:');
	});
});

describe('what it may not', () => {
	test('positioning, dimensions and layout modes stay blocked', () => {
		const escape =
			'position:fixed;inset:0;top:0;left:0;width:100vw;height:100vh;' +
			'margin:0;padding:0;transform:scale(3);z-index:9999;display:flex;opacity:1';
		expect(sanitizeDecorations(escape)).toBe('margin: 0; padding: 0');
	});

	test('nothing can reach off this machine', () => {
		expect(sanitizeDecorations('background-color:url(https://example.com/pixel.png)')).toBe('');
		expect(sanitizeDecorations('background-color:image-set("https://x/y.png" 1x)')).toBe('');
		expect(sanitizeDecorations('color:rgb(var(--leak))')).toBe('');
	});

	test('gradients belong to backgrounds, not colour properties', () => {
		expect(sanitizeDecorations('background:linear-gradient(90deg,#202433,#12141c)')).toBe('background: linear-gradient(90deg,#202433,#12141c)');
		expect(sanitizeDecorations('background-color:linear-gradient(90deg,#000,#fff)')).toBe('');
	});

	test('a value that is not the property it claims to be is dropped whole', () => {
		expect(sanitizeDecorations('font-weight:900px')).toBe('');
		expect(sanitizeDecorations('text-align:absolute')).toBe('');
		expect(sanitizeDecorations('color:')).toBe('');
	});

	test('!important cannot out-rank the app on a property it does own', () => {
		expect(sanitizeDecorations('color:#fff !important')).toBe('color: #fff');
	});

	test('output is rebuilt, so nothing unparsed rides along', () => {
		// A closing brace would end the app's own rule if the attribute were passed
		// through as written; re-serializing from the parsed pairs is what stops it.
		expect(sanitizeDecorations('color:red} .app{display:none')).toBe('');
		expect(sanitizeDecorations('color:red;} body{color:blue')).toBe('color: red');
	});

	test('unlisted effects remain blocked alongside an allowed border colour', () => {
		expect(sanitizeDecorations('border-color:#c45a72;box-shadow:0 0 8px #c45a72')).toBe('border-color: #c45a72');
	});
});

describe('the legacy font colour', () => {
	test('accepts colours and refuses everything else', () => {
		expect(isDecorationColor('#d8c37a')).toBe(true);
		expect(isDecorationColor(' rebeccapurple ')).toBe(true);
		expect(isDecorationColor('hsl(210 40% 50%)')).toBe(true);
		expect(isDecorationColor('url(https://example.com/x.png)')).toBe(false);
		expect(isDecorationColor('#fff; position: fixed')).toBe(false);
	});
});

describe('bounded typography and appearance', () => {
	for (const size of ['24px', '1.4em', '1.25rem', '120%']) {
		test(`font size ${size} survives with absolute bounds`, () => {
			const result = sanitizeDecorations(`font-size: ${size}`);
			expect(result).toBe(`font-size: clamp(8px, ${size}, 64px)`);
			expect(sanitizeDecorations(result)).toBe(result);
		});
	}
	for (const style of [
		'font-family: "Times New Roman", Georgia, serif', 'font-family: system-ui, sans-serif',
		'font-style: italic', 'font-variant: small-caps', 'font-weight: 650',
		'line-height: 1.6', 'line-height: 150%', 'line-height: 24px',
		'letter-spacing: -0.05em', 'word-spacing: 4px',
		'text-transform: uppercase', 'text-decoration: underline line-through',
		'text-decoration-style: wavy', 'text-decoration-color: rgb(20, 30, 40)',
		'text-decoration-thickness: 2px', 'text-underline-offset: 0.2em',
		'padding: 12px 1em 0 0.5rem', 'margin: 0 auto', 'padding-inline: 0 12px',
		'margin-block-end: 1rem', 'border: 1px solid rgba(255, 255, 255, .2)',
		'border-inline-start: 3px dashed teal', 'border-color: red blue',
		'border-width: 1px 2px', 'border-style: solid dotted',
		'border-radius: 12px 4px / 8px 2px', 'border-start-start-radius: 0.5em',
		'background: linear-gradient(to bottom right, #202433, rgba(18, 20, 28, .8) 100%)',
		'background-image: radial-gradient(circle at center, red 0%, blue 100%)',
		'background-image: conic-gradient(from 45deg at 50% 50%, red 0deg, blue 360deg)',
		'background-image: linear-gradient(red, blue), radial-gradient(circle, transparent, black)',
	]) {
		test(`keeps ${style}`, () => {
			expect(sanitizeDecorations(style)).toBe(style);
		});
	}
	for (const style of [
		'font-size: 0', 'font-size: -1em', 'font-size: 10000px', 'font-size: 100vw',
		'font-size: 999999999999999999999em', 'font-size: calc(1em + 100vw)',
		'font-size: clamp(0px, 100vw, 9999px)', 'font-family: var(--font)',
		'font-family: url(https://example.com/font)', 'font-family: "x" garbage()',
		'line-height: .1', 'line-height: 999', 'letter-spacing: -100px',
		'padding: -1px', 'padding: 999px', 'margin: -1em', 'margin-left: -100vw',
		'border: 100px solid red', 'border: 1px 2px solid', 'border-radius: 999px',
		'background: url(https://example.com/pixel)',
		'background-image: linear-gradient(red, url(https://example.com/pixel))',
		'background: linear-gradient(red, blue), url(https://example.com/pixel)',
		'background-image: image-set("https://example.com/pixel" 1x)',
		'background: linear-gradient(red, var(--remote))',
		'background: linear-gradient(rgb(from var(--x) r g b), blue)',
		'background: linear-gradient(red, blue', 'background: linear-gradient(red, blue))',
		'background: linear-gradient(red,,blue)', 'background: linear-gradient(90deg, red)',
		'background: linear-gradient(red, blue) fixed', 'background-attachment: fixed',
		'position: sticky', 'float: right', 'display: grid', 'z-index: 999',
		'width: 100%', 'height: 100vh', 'animation: spin 1s infinite',
		'color: var(--accent)', 'color: rgb(var(--x))', 'background: u\\72l(example.com)',
		'background: u/**/rl(example.com)', 'font-size: expression(alert(1))',
	]) {
		test(`rejects ${style}`, () => {
			expect(sanitizeDecorations(style)).toBe('');
		});
	}
	test('caps parsing work and gradient layers/stops', () => {
		expect(sanitizeDecorations('color:red;'.repeat(1000))).toBe('');
		expect(sanitizeDecorations(`background: ${Array(5).fill('linear-gradient(red, blue)').join(',')}`)).toBe('');
		expect(sanitizeDecorations(`background: linear-gradient(${Array(18).fill('red').join(',')})`)).toBe('');
	});
	test('a mixed replacement keeps useful styles without dangerous declarations', () => {
		const input = 'font-size:24px!important;position:fixed;top:0;color:red;margin:-10px;padding:12px;background:url(https://x)';
		expect(sanitizeDecorations(input)).toBe('font-size: clamp(8px, 24px, 64px); color: red; padding: 12px');
	});
});
