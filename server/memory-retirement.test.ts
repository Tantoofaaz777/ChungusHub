import { expect, test } from 'bun:test';
import { callDbMethod } from './db';

test('retired automatic memory RPCs cannot read or mutate stored legacy rows', () => {
 for (const method of ['memGetState', 'memListEpisodes', 'memSetState', 'memApplyBatch',
  'memApplyPromotion', 'memReapEpisodes', 'memUpdateEpisodeContent', 'memReset']) {
  expect(() => callDbMethod(method, ['a-chat'])).toThrow(`Unknown db method: ${method}`);
 }
});
