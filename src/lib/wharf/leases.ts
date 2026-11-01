import { API, Name, NameType } from '@wharfkit/antelope';

import { AccountRequiredResources } from './actions/powerup';
import { getClient } from './client';
import { getAccountRequiredResources } from './resources';

import { ManagedAccount } from '$lib/db/models/manager/account';
import { managerLog } from '$lib/logger';
import { ANTELOPE_SYSTEM_CONTRACT, MANAGER_RENEW_BEFORE_EXPIRY_MINUTES } from 'src/config';

export interface PowerupOrder {
	owner: string;
	cpu_weight: number | string;
	net_weight: number | string;
	expires: string;
}

export async function getPowerupOrders(account: NameType): Promise<PowerupOrder[]> {
	const owner = String(Name.from(account));
	const result = (await getClient().v1.chain.get_table_rows({
		code: ANTELOPE_SYSTEM_CONTRACT,
		scope: '0',
		table: 'powup.order',
		index_position: 'secondary',
		key_type: 'name',
		lower_bound: Name.from(owner),
		upper_bound: Name.from(owner),
		limit: 1000
	})) as API.v1.GetTableRowsResponse;
	return (result.rows as PowerupOrder[]).filter((row) => row.owner === owner);
}

function parseExpiry(order: PowerupOrder): number {
	return Date.parse(order.expires.endsWith('Z') ? order.expires : `${order.expires}Z`);
}

// True when the weight of leases expiring inside the window outweighs the weight that
// stays after it. Using only the newest lease missed a big lease expiring next to a
// small, newer one (Nov 1 outage). After a same-size renewal it stops triggering.
function expiringOutweighsRemaining(
	orders: PowerupOrder[],
	weight: 'cpu_weight' | 'net_weight',
	cutoff: number
): boolean {
	let expiring = 0;
	let remaining = 0;
	for (const order of orders) {
		const w = Number(order[weight]);
		if (!(w > 0)) continue;
		if (parseExpiry(order) <= cutoff) expiring += w;
		else remaining += w;
	}
	return expiring > remaining;
}

// An account needs a renewal when its newest CPU (or NET) lease expires within the window.
// Once renewed, the new lease expires ~24h later, so this stops triggering on its own.
export function getLeaseRenewals(
	orders: PowerupOrder[],
	now = Date.now(),
	windowMinutes = MANAGER_RENEW_BEFORE_EXPIRY_MINUTES
): AccountRequiredResources {
	const cutoff = now + windowMinutes * 60 * 1000;
	return {
		cpuRequired: windowMinutes > 0 && expiringOutweighsRemaining(orders, 'cpu_weight', cutoff),
		netRequired: windowMinutes > 0 && expiringOutweighsRemaining(orders, 'net_weight', cutoff)
	};
}

// Shared by managed accounts and the manager's own self-management: low free resources
// OR a lease about to expire both trigger a powerup.
export async function getRequiredResourcesWithRenewals(
	managed: ManagedAccount,
	data: API.v1.AccountObject
): Promise<AccountRequiredResources> {
	const required = getAccountRequiredResources(managed, data);
	const renewals = getLeaseRenewals(await getPowerupOrders(managed.account));
	if (renewals.cpuRequired || renewals.netRequired) {
		managerLog.info('Account leases expiring soon, renewing', {
			account: String(managed.account),
			...renewals
		});
	}
	return {
		cpuRequired: required.cpuRequired || renewals.cpuRequired,
		netRequired: required.netRequired || renewals.netRequired
	};
}
