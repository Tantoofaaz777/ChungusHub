import { expect, test } from 'bun:test';
import { mapSpeechToDisplay, speechHighlightInk } from './speech-highlight';
import { contrastRatio } from './contrast';

test('highlight chooses the better black/white contrast across light and dark accents', () => {
 for (const accent of ['#ffffff', '#000000', '#64d5c7', '#ff0000', '#222266', '#777777']) {
  expect(contrastRatio(speechHighlightInk(accent), accent)).toBeGreaterThanOrEqual(4.5);
 }
 expect(speechHighlightInk('#ffffff')).toBe('#000000'); expect(speechHighlightInk('#000000')).toBe('#ffffff');
});
test('mapping ignores whitespace differences and extra display-only trackers', () => {
 const source = 'She smiled.\n\n“Come here.”', display = 'Tracker\nShe  smiled.\n“Come here.”\nFooter';
 const map = mapSpeechToDisplay(source, display);
 for (let i = 0; i < source.length; i++) if (!/\s/.test(source[i])) expect(display[map[i]]).toBe(source[i]);
 expect(map[0]).toBe(display.indexOf('She'));
});
test('unchanged blocks map around display rewrites without guessing at edited passages', () => {
 const source = 'First scene.\nChanged scene.\nLast scene.', display = 'First scene.\nDifferent wording.\nLast scene.';
 const map = mapSpeechToDisplay(source, display);
 expect(map[0]).toBe(0); expect(map[source.indexOf('Changed')]).toBe(-1);
 expect(map[source.indexOf('Last')]).toBe(display.indexOf('Last'));
});
test('repeated identical sentences preserve occurrence positions, and ambiguous removed duplicates stay unmapped', () => {
 const source = 'Again.\nAgain.\nEnd.', identical = mapSpeechToDisplay(source, source);
 expect(identical[source.lastIndexOf('Again')]).toBe(source.lastIndexOf('Again'));
 const removed = mapSpeechToDisplay(source, 'Again.\nChanged end.');
 expect(removed[0]).toBe(-1); expect(removed[source.lastIndexOf('Again')]).toBe(-1);
});
test('mismatched or excessively transformed text has no speculative mapping', () => {
 expect([...mapSpeechToDisplay('Story.', 'Different.')].every(n => n === -1)).toBe(true);
 expect([...mapSpeechToDisplay('Story.', 'x'.repeat(250001))].every(n => n === -1)).toBe(true);
 expect([...mapSpeechToDisplay('Hello.', 'NotHello.')].every(n => n === -1)).toBe(true);
 expect([...mapSpeechToDisplay('Hello', 'HelloThere')].every(n => n === -1)).toBe(true);
});
