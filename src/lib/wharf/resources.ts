import { API, Int64 } from '@wharfkit/antelope';
import { Resources } from '@wharfkit/resources';

import { getClient } from './client';

import { ManagedAccount } from '$lib/db/models/manager/account';
import { generalLog, managerLog } from '$lib/logger';
import { AccountResources } from '$lib/types';
import { objectify } from '$lib/utils';
import { ANTELOPE_SAMPLE_ACCOUNT, ENABLE_MANAGED_ACCOUNT_RAM } from 'src/config';

export function getResourcesClient() {
	return new Resources({
		api: getClient(),
		sampleAccount: ANTELOPE_SAMPLE_ACCOUNT
	});
}

export async function getSampledUsage() {
	const usage = await getResourcesClient().getSampledUsage();
	generalLog.silly('Sampled Usage', objectify(usage));
	return usage;
}

export function getAccountCurrentResources(data: API.v1.AccountObject): AccountResources {
	const resources = {
		cpu: data.cpu_limit.max.subtracting(data.cpu_limit.current_used),
		net: data.net_limit.max.subtracting(data.net_limit.current_used),
		ram: data.ram_quota.subtracting(data.ram_usage)
	};
	generalLog.debug('Current Account Resources', {
		account: String(data.account_name),
		cpu: Number(resources.cpu),
		net: Number(resources.net),
		ram: Number(resources.ram)
	});
	return resources;
}

export function getAccountRequiresCPU(
	account: ManagedAccount,
	resources: AccountResources
): boolean {
	const cpuMinimum = account.min_ms.multiplying(1000);
	const cpuRequired = resources.cpu.lt(cpuMinimum);
	managerLog.debug(
		'Account CPU Resource Status',
		objectify({ cpuMinimum, cpuCurrent: resources.cpu, cpuRequired })
	);
	return cpuRequired;
}

export function getAccountRequiresNET(
	account: ManagedAccount,
	resources: AccountResources
): boolean {
	const netMinimum = account.min_kb.multiplying(1000);
	const netRequired = resources.net.lt(netMinimum);
	managerLog.debug(
		'Account NET Resource Status',
		objectify({ netMinimum, netCurrent: resources.net, netRequired })
	);
	return netRequired;
}

export function getAccountRequiresRAM(
	account: ManagedAccount,
	resources: AccountResources
): boolean {
	if (!ENABLE_MANAGED_ACCOUNT_RAM) {
		return false;
	}
	if (account.min_ram_kb.lte(Int64.zero) || account.inc_ram_kb.lte(Int64.zero)) {
		return false;
	}
	const ramMinimum = account.min_ram_kb.multiplying(1000);
	const ramRequired = resources.ram.lt(ramMinimum);
	managerLog.debug(
		'Account RAM Resource Status',
		objectify({ ramMinimum, ramCurrent: resources.ram, ramRequired })
	);
	return ramRequired;
}

export function getAccountRequiredResources(managed: ManagedAccount, data: API.v1.AccountObject) {
	const resources = getAccountCurrentResources(data);
	const cpuRequired = getAccountRequiresCPU(managed, resources);
	const netRequired = getAccountRequiresNET(managed, resources);
	const ramRequired = getAccountRequiresRAM(managed, resources);
	if (cpuRequired || netRequired || ramRequired) {
		managerLog.info(
			'Account requires additional resources',
			objectify({
				account: managed.account,
				cpu: {
					current: resources.cpu,
					minimum: managed.min_ms.multiplying(1000),
					required: cpuRequired
				},
				net: {
					current: resources.net,
					minimum: managed.min_kb.multiplying(1000),
					required: netRequired
				},
				ram: {
					current: resources.ram,
					minimum: managed.min_ram_kb.multiplying(1000),
					required: ramRequired
				}
			})
		);
	}
	return { cpuRequired, netRequired, ramRequired };
}
