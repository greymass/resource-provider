import { Transaction, PermissionLevel } from '@wharfkit/antelope';
import { expect, test } from 'bun:test';

import { provisionRam } from '../src/lib/wharf/ram-provisioning';
const transaction = Transaction.from({
	expiration: '2026-09-26T12:00:00',
	ref_block_num: 1,
	ref_block_prefix: 1,
	actions: []
});
const requester = PermissionLevel.from('player.gm@active');
test('gift is obtained before estimation and no user-paid action is appended', async () => {
	const order: string[] = [];
	const result = await provisionRam(transaction, requester, {
		ensure: async () => {
			order.push('gift');
			return true;
		},
		compute: async () => {
			order.push('compute');
			return { cpu: 1, net: 1, ram: 0 };
		},
		buy: async () => {
			throw new Error('user purchase must not run');
		}
	});
	expect(order).toEqual(['gift', 'compute']);
	expect(result.transaction).toBe(transaction);
});
test('an oversized transaction cannot charge a pass holder for additional RAM', async () => {
	await expect(
		provisionRam(transaction, requester, {
			ensure: async () => true,
			compute: async () => ({ cpu: 1, net: 1, ram: 50000 }),
			buy: async () => {
				throw new Error('user purchase must not run');
			}
		})
	).rejects.toThrow('sponsored capacity allowance');
});

test('waits briefly for a successful gift to propagate before rejecting a transaction', async () => {
	let samples = 0;
	const result = await provisionRam(transaction, requester, {
		ensure: async () => true,
		compute: async () => ({ cpu: 1, net: 1, ram: ++samples === 1 ? 100 : 0 }),
		buy: async () => {
			throw new Error('user purchase must not run');
		}
	});
	expect(result.resources.ram).toBe(0);
	expect(samples).toBe(2);
});
