/** Download public HTTPS card assets with a pinned DNS result and bounded redirects/body. */
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';

const MAX_BYTES = 25 * 1024 * 1024;

export function publicAssetIp(address: string): boolean {
	if (isIP(address) === 4) {
		const [a, b] = address.split('.').map(Number);
		return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
			!(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
			!(a === 172 && b >= 16 && b <= 31) && !(a === 192 && [0, 168].includes(b)) &&
			!(a === 198 && [18, 19, 51].includes(b)) && !(a === 203 && b === 0);
	}
	// Global unicast only. Mapped IPv4, local/link-local, multicast and documentation
	// prefixes are rejected instead of being interpreted as internet destinations.
	return isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:db8|0*0|0*2):/i.test(address) && !/^2002:/i.test(address);
}

export async function downloadCardAsset(input: string, redirects = 0): Promise<{ bytes: Buffer; mime: string }> {
	const url = new URL(input);
	if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
		throw new Error('Card assets must use a public HTTPS address on port 443.');
	}
	const hostname = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
	if (!addresses.length || addresses.some(({ address }) => !publicAssetIp(address))) throw new Error('Private or reserved card asset addresses are not allowed.');
	const chosen = addresses[0];
	const answer = await new Promise<{ bytes?: Buffer; mime?: string; location?: string }>((resolve, reject) => {
		const req = request(url, {
			signal: AbortSignal.timeout(15000),
			family: chosen.family,
			// The TLS server name and Host stay the URL's hostname. The actual connection
			// is pinned to this already checked address, preventing a DNS rebind.
			lookup: (_name, _options, callback) => callback(null, chosen.address, chosen.family),
			headers: { 'user-agent': 'ChungusHub CharacterCard/3', accept: '*/*' }
		}, (res) => {
			if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
				res.destroy();
				resolve({ location: new URL(res.headers.location, url).href });
				return;
			}
			if (res.statusCode !== 200 || Number(res.headers['content-length'] ?? 0) > MAX_BYTES) {
				res.destroy(); reject(new Error('Card asset is unavailable or exceeds 25 MiB.')); return;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			res.on('data', (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_BYTES) res.destroy(new Error('Card asset exceeds 25 MiB.'));
				else chunks.push(chunk);
			});
			res.on('error', reject);
			res.on('end', () => resolve({ bytes: Buffer.concat(chunks), mime: res.headers['content-type']?.split(';')[0] ?? 'application/octet-stream' }));
		});
		req.setTimeout(10000, () => req.destroy(new Error('Card asset download timed out.')));
		req.on('error', reject);
		req.end();
	});
	if (answer.location) {
		if (redirects >= 3) throw new Error('Too many card asset redirects.');
		return downloadCardAsset(answer.location, redirects + 1);
	}
	return { bytes: answer.bytes!, mime: answer.mime! };
}
