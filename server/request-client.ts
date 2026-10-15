import { isIP } from 'node:net';

function normal(ip: string): string {
	return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function loopback(ip: string): boolean {
	return ['127.0.0.1', '::1'].includes(normal(ip));
}

function requestHost(headers: Headers): string | null {
	try {
		return new URL(`http://${headers.get('host')}`).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/** Local proxies must append their peer to XFF, as Vite and Cloudflare do.
 * Earlier entries belong to the visitor and cannot grant an IP or loopback exemption.
 * Unknown proxy visitors remain non-local, so a missing/invalid header cannot unlock
 * a public hostname just because cloudflared reaches us over localhost. */
export function requestClientIp(
	peer: string | null,
	headers: Headers,
	publicHostnames: readonly string[]
): string | null {
	if (!peer || !loopback(peer)) return peer;
	const host = requestHost(headers);
	const forwarded = headers.get('x-forwarded-for');
	if (forwarded !== null) {
		const ip = normal(forwarded.split(',').at(-1)!.trim());
		if (!isIP(ip)) return null;
		// Local Vite requests still get the loopback exemption. A public origin
		// never does, even if an intermediate proxy sends a loopback address.
		if (loopback(ip) && host !== 'localhost' && host !== '[::1]' && host !== '127.0.0.1') return null;
		return ip;
	}
	if (host && publicHostnames.includes(host)) return null;
	return peer;
}
