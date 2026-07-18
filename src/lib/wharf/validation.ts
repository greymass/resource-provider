import { Name, PermissionLevel } from '@wharfkit/antelope';
import type { API, PermissionLevelType } from '@wharfkit/antelope';

import { getBool, getInt } from '$lib/settings';

export function resolvePermissionLevel(signer: PermissionLevelType): PermissionLevel {
	if (!signer.actor || String(Name.from(signer.actor)) !== signer.actor) {
		throw new Error('Invalid actor in signer');
	}
	if (!signer.permission || String(Name.from(signer.permission)) !== signer.permission) {
		throw new Error('Invalid permission in signer');
	}
	return PermissionLevel.from({
		actor: signer.actor,
		permission: signer.permission
	});
}

export function checkResourceSufficiency(accountData: API.v1.AccountObject): void {
	if (!getBool('provider.require_resource_need')) {
		return;
	}

	const cpuAvailable = Number(
		accountData.cpu_limit.max.subtracting(accountData.cpu_limit.current_used)
	);
	const netAvailable = Number(
		accountData.net_limit.max.subtracting(accountData.net_limit.current_used)
	);

	if (
		cpuAvailable > getInt('provider.min_cpu_us') &&
		netAvailable > getInt('provider.min_net_bytes')
	) {
		throw new Error('Network resources not required by this account.');
	}
}

export function validateRequester(cosigner: PermissionLevel, requester: PermissionLevel): void {
	if (requester.actor.equals(cosigner.actor)) {
		throw new Error('Signer cannot be the cosigner.');
	}
}
