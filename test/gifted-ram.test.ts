import { expect, test } from 'bun:test';

import { ensureSponsoredRam } from '../src/lib/wharf/ram-manager';
const chainId = '73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d';
test('Resource Provider uses a sponsored gift without a player-paid RAM action', async () => {
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: () => Response.json({ status: 'gifted' })
	});
	try {
		expect(
			await ensureSponsoredRam('player.gm', 'request-1', {
				url: server.url.origin,
				token: 'test-token-012345678901234567890123',
				chainId
			})
		).toBe(true);
	} finally {
		await server.stop(true);
	}
});

test('budget caps and other givers never fall back to charging the player', async () => {
	for (const status of ['other_gifter', 'budget_exceeded', 'pending']) {
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch: () => Response.json({ status })
		});
		try {
			await expect(
				ensureSponsoredRam('player.gm', 'request-1', {
					url: server.url.origin,
					token: 'test-token-012345678901234567890123',
					chainId
				})
			).rejects.toThrow('operator review');
		} finally {
			await server.stop(true);
		}
	}
});
test('disabled service preserves the existing Resource Provider behavior', async () => {
	expect(await ensureSponsoredRam('player.gm', 'request-1', {})).toBe(false);
});
test('mismatched chain and partial settings reject before making any purchase', async () => {
	await expect(
		ensureSponsoredRam('player.gm', 'request-1', { url: 'https://ram.example' })
	).rejects.toThrow('not configured');
});
