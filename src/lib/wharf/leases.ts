import { API, Name, NameType } from '@wharfkit/antelope';

import { AccountRequiredResources } from './actions/powerup';
import { getClient } from './client';

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

function latestExpiry(
	orders: PowerupOrder[],
	weight: 'cpu_weight' | 'net_weight'
): number | undefined {
	const times = orders
		.filter((order) => Number(order[weight]) > 0)
		.map((order) => Date.parse(order.expires.endsWith('Z') ? order.expires : `${order.expires}Z`));
	return times.length ? Math.max(...times) : undefined;
}

// An account needs a renewal when its newest CPU (or NET) lease expires within the window.
// Once renewed, the new lease expires ~24h later, so this stops triggering on its own.
export function getLeaseRenewals(
	orders: PowerupOrder[],
	now = Date.now(),
	windowMinutes = MANAGER_RENEW_BEFORE_EXPIRY_MINUTES
): AccountRequiredResources {
	const cutoff = now + windowMinutes * 60 * 1000;
	const cpu = latestExpiry(orders, 'cpu_weight');
	const net = latestExpiry(orders, 'net_weight');
	return {
		cpuRequired: windowMinutes > 0 && cpu !== undefined && cpu <= cutoff,
		netRequired: windowMinutes > 0 && net !== undefined && net <= cutoff
	};
}
