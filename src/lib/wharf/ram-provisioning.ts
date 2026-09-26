import { UInt64 } from '@wharfkit/antelope';
import type { PermissionLevel, Transaction } from '@wharfkit/antelope';

import { addBuyRAMBytesAction } from './actions/ram';
import { computeResourceNeeds, RAM_SAFETY_BUFFER_BYTES } from './estimation';
import { ensureSponsoredRam } from './ram-manager';

import { ANTELOPE_CHAIN_ID, RAM_MANAGER_URL, RAM_MANAGER_TOKEN } from 'src/config';
const dependencies = {
	ensure: (account: string, requestId: string) =>
		ensureSponsoredRam(account, requestId, {
			url: RAM_MANAGER_URL,
			token: RAM_MANAGER_TOKEN,
			chainId: ANTELOPE_CHAIN_ID
		}),
	compute: computeResourceNeeds,
	buy: addBuyRAMBytesAction
};
export async function provisionRam(
	transaction: Transaction,
	requester: PermissionLevel,
	deps = dependencies
) {
	const sponsored = await deps.ensure(String(requester.actor), 'rp:' + String(transaction.id));
	let resources = await deps.compute(transaction);
	for (let attempt = 0; sponsored && resources.ram > 0 && attempt < 2; attempt++) {
		await Bun.sleep(250);
		resources = await deps.compute(transaction);
	}
	if (resources.ram <= 0) return { transaction, resources, sponsored };
	// A pass holder is never silently downgraded to a player-funded RAM purchase.
	if (sponsored) throw new Error('Transaction exceeds the sponsored capacity allowance.');
	const bytes = UInt64.from(resources.ram + RAM_SAFETY_BUFFER_BYTES);
	return { transaction: await deps.buy(transaction, requester, bytes), resources };
}
