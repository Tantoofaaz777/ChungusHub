import { expect, test } from 'bun:test';
import { downloadCardAsset, publicAssetIp } from './card-assets';

test.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::', 'not-an-ip'])('card assets reject private/reserved IP %s', (ip) => {
	expect(publicAssetIp(ip)).toBe(false);
});
test.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('card assets accept public IP %s', (ip) => expect(publicAssetIp(ip)).toBe(true));
test.each(['http://example.com/a.png', 'file:///etc/passwd', 'https://user:pass@example.com/a', 'https://example.com:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/a'])('asset download blocks unsafe URL before requesting %s', async (url) => {
	await expect(downloadCardAsset(url)).rejects.toThrow();
});
