import { expect, test } from 'bun:test';
import { requestClientIp } from './request-client';

const names = ['chungus.example.com'];
const headers = (host: string, xff?: string) => new Headers({ host, ...(xff === undefined ? {} : { 'x-forwarded-for': xff }) });

test('direct remote peers cannot forge their address', () => {
	expect(requestClientIp('203.0.113.9', headers(names[0], '127.0.0.1'), names)).toBe('203.0.113.9');
});

test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('the local proxy at %s uses its appended visitor', (peer) => {
	expect(requestClientIp(peer, headers(names[0], '127.0.0.1, 203.0.113.9'), names)).toBe('203.0.113.9');
	expect(requestClientIp(peer, headers(names[0], '198.51.100.1, 2001:db8::1'), names)).toBe('2001:db8::1');
});

test.each(['', 'garbage', '203.0.113.9,', '127.0.0.1', '::1', '::ffff:127.0.0.1'])('a public visitor with XFF %j cannot become loopback', (xff) => {
	expect(requestClientIp('127.0.0.1', headers(names[0], xff), names)).toBeNull();
});

test('a public hostname without visitor headers still needs a password', () => {
	expect(requestClientIp('127.0.0.1', headers('CHUNGUS.example.com:4242'), names)).toBeNull();
});

test('direct localhost and the local Vite proxy retain local access', () => {
	for (const host of ['localhost:4242', '127.0.0.1:4242', '[::1]:4242']) {
		expect(requestClientIp('127.0.0.1', headers(host), names)).toBe('127.0.0.1');
		expect(requestClientIp('127.0.0.1', headers(host, '127.0.0.1'), names)).toBe('127.0.0.1');
	}
	expect(requestClientIp('127.0.0.1', headers('my-machine:4242'), names)).toBe('127.0.0.1');
});
