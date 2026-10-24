import { expect, test } from 'bun:test';
import { latestRelease } from './about';
import { LATEST_RELEASE_API, PROJECT_URL } from '../shared/project';

test('update checks query the fork, send no workspace data and return its release', async () => {
 let requested = '';
 const result = await latestRelease((async (url, options) => {
  requested = String(url);
  expect(options?.headers).toEqual({ accept: 'application/vnd.github+json', 'user-agent': 'ChungusHub' });
  expect(options?.body).toBeUndefined();
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  return Response.json({ tag_name: 'v2.0.0', html_url: `${PROJECT_URL}/releases/tag/v2.0.0` });
 }) as typeof fetch);
 expect(requested).toBe(LATEST_RELEASE_API);
 expect(new URL(requested).pathname).toBe('/repos/Tantoofaaz777/ChungusHub/releases/latest');
 expect(result).toEqual({ version: '2.0.0', url: `${PROJECT_URL}/releases/tag/v2.0.0` });
});

test('missing stable releases, rate limits, malformed answers and network errors never report up to date', async () => {
 for (const [status, message] of [[404, 'no stable server release'], [403, 'rate limiting'], [429, 'rate limiting'], [500, '500']] as const) {
  await expect(latestRelease((async () => new Response('', { status })) as typeof fetch)).rejects.toThrow(message);
 }
 await expect(latestRelease((async () => Response.json({ tag_name: 42 })) as typeof fetch)).rejects.toThrow('cannot read');
 await expect(latestRelease((async () => { throw new Error('Offline'); }) as typeof fetch)).rejects.toThrow('Offline');
});
