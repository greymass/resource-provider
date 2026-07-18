import { Asset } from '@wharfkit/antelope';
import { PowerUpState } from '@wharfkit/resources';

import { providerLog } from '$lib/logger';
import { getString } from '$lib/settings';
import { objectify } from '$lib/utils';
import type { ResourceCosts, ResourceNeeds } from '$lib/wharf/estimation';
import { getResourcesClient } from '$lib/wharf/resources';
import { ANTELOPE_SYSTEM_TOKEN } from 'src/config';

export async function calculateCosts(resourceNeeds: ResourceNeeds): Promise<ResourceCosts> {
	const resourcesClient = getResourcesClient();
	const powerupState = await resourcesClient.v1.powerup.get_state();
	const powerup = PowerUpState.from(powerupState);
	const sample = await resourcesClient.getSampledUsage();

	const cpuMs = resourceNeeds.cpu / 1000;
	const netKb = resourceNeeds.net / 1000;

	const zeroCost = () => Asset.from(0, ANTELOPE_SYSTEM_TOKEN);

	let cpuCost: Asset;
	try {
		cpuCost =
			cpuMs > 0
				? Asset.fromFloat(powerup.cpu.price_per_ms(sample, cpuMs), ANTELOPE_SYSTEM_TOKEN)
				: zeroCost();
	} catch {
		cpuCost = zeroCost();
	}

	let netCost: Asset;
	try {
		netCost =
			netKb > 0
				? Asset.fromFloat(powerup.net.price_per_kb(sample, netKb), ANTELOPE_SYSTEM_TOKEN)
				: zeroCost();
	} catch {
		netCost = zeroCost();
	}

	let ramCost = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	if (resourceNeeds.ram > 0) {
		const ramState = await resourcesClient.v1.ram.get_state();
		ramCost = ramState.price_per_kb(resourceNeeds.ram / 1024);
	}

	providerLog.debug('Cost calculations', objectify({ cpuCost, netCost, ramCost }));

	return { cpu: cpuCost, net: netCost, ram: ramCost };
}

export function calculateTotalFee(costs: ResourceCosts): Asset {
	const total = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	total.units.add(costs.cpu.units);
	total.units.add(costs.net.units);
	total.units.add(costs.ram.units);

	const minimumFeeSetting = getString('provider.paid_transactions.minimum_fee');
	if (minimumFeeSetting) {
		const minimumFee = Asset.from(minimumFeeSetting);
		if (total.units.lte(minimumFee.units)) {
			return minimumFee;
		}
	}

	return total;
}
