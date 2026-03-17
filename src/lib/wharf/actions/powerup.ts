import { Asset, Int64, Name } from '@wharfkit/antelope';
import { PowerUpState, SampleUsage } from '@wharfkit/resources';

import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import { ANTELOPE_SYSTEM_TOKEN } from 'src/config';

const MINIMUM_BILLABLE_POWERUP_COST = 0.0001;
const MAX_BILLABLE_POWERUP_ADJUSTMENTS = 32;

export interface AccountRequiredResources {
	cpuRequired: boolean;
	netRequired: boolean;
}

interface MinimumBillableAmountResult {
	amount: Int64;
	cost: number;
}

function isBelowPrecisionError(error: unknown): boolean {
	return String(error).includes('below required precision');
}

export function getMinimumBillablePowerupAmount(
	amount: Int64,
	required: boolean,
	getCost: (amount: number) => number,
	resource: 'cpu' | 'net'
): MinimumBillableAmountResult {
	if (!required || amount.lte(Int64.zero)) {
		return { amount, cost: 0 };
	}

	let adjustedAmount = Int64.from(amount);
	let cost = 0;
	let attempts = 0;

	for (;;) {
		try {
			cost = getCost(Number(adjustedAmount));
		} catch (error) {
			if (!isBelowPrecisionError(error)) {
				throw error;
			}
			cost = 0;
		}

		if (cost >= MINIMUM_BILLABLE_POWERUP_COST) {
			break;
		}

		if (attempts >= MAX_BILLABLE_POWERUP_ADJUSTMENTS) {
			throw new Error(
				'Unable to derive a billable ' +
					resource.toUpperCase() +
					' powerup amount for ' +
					String(amount) +
					'.'
			);
		}

		adjustedAmount = adjustedAmount.multiplying(2);
		attempts += 1;
	}

	if (!adjustedAmount.equals(amount)) {
		managerLog.info('Adjusted powerup amount to meet minimum billable precision', {
			resource,
			requested: String(amount),
			adjusted: String(adjustedAmount),
			cost
		});
	}

	return { amount: adjustedAmount, cost };
}

export function getPowerupParamsCPU(
	ms: Int64,
	powerup: PowerUpState,
	sample: SampleUsage,
	requirements: AccountRequiredResources
) {
	const cpu_cost = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	const cpu_frac = Int64.from(0);
	if (requirements.cpuRequired) {
		const adjusted = getMinimumBillablePowerupAmount(
			ms,
			requirements.cpuRequired,
			(amount) => powerup.cpu.price_per_ms(sample, amount),
			'cpu'
		);
		cpu_frac.add(powerup.cpu.frac_by_ms(sample, Number(adjusted.amount)));
		cpu_cost.units.add(Asset.fromFloat(adjusted.cost, ANTELOPE_SYSTEM_TOKEN).units);
	}
	return { cpu_cost, cpu_frac };
}

export function getPowerupParamsNET(
	kb: Int64,
	powerup: PowerUpState,
	sample: SampleUsage,
	requirements: AccountRequiredResources
) {
	const net_cost = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	const net_frac = Int64.from(0);
	if (requirements.netRequired) {
		const cost = powerup.net.price_per_kb(sample, Number(kb));
		net_frac.add(powerup.net.frac_by_kb(sample, Number(kb)));
		net_cost.units.add(Asset.fromFloat(cost, ANTELOPE_SYSTEM_TOKEN).units);
	}
	return { net_cost, net_frac };
}

export function getPowerupParams(
	ms: Int64,
	kb: Int64,
	powerup: PowerUpState,
	sample: SampleUsage,
	requirements: AccountRequiredResources,
	payer: Name,
	receiver: Name,
	max_payment: Asset
) {
	const { cpu_cost, cpu_frac } = getPowerupParamsCPU(ms, powerup, sample, requirements);
	const { net_cost, net_frac } = getPowerupParamsNET(kb, powerup, sample, requirements);

	const params = {
		cpu_frac,
		net_frac,
		payer,
		receiver,
		days: 1,
		max_payment
	};

	managerLog.debug('Powerup Calculations', objectify({ params, costs: { cpu_cost, net_cost } }));

	return params;
}
