import { Asset, Int64, Name } from '@wharfkit/antelope';
import { PowerUpState, SampleUsage } from '@wharfkit/resources';

import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import { ANTELOPE_SYSTEM_TOKEN } from 'src/config';

const MAX_BILLABLE_POWERUP_ADJUSTMENTS = 32;
const POWERUP_FRACTION_DENOMINATOR = 1_000_000_000_000_000n;

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

function numberValue(value: unknown): number {
	if (typeof value === 'object' && value && 'value' in value) {
		return Number(String((value as { value: unknown }).value));
	}

	return Number(String(value));
}

function assetPrecision(asset: Asset): number {
	return asset.symbol.precision;
}

function roundUpAssetValue(value: number, precision: number): number {
	const units = Math.pow(10, precision);
	return Math.ceil(value * units) / units;
}

function utilizationIncreaseForFraction(weight: Int64, frac: Int64): number {
	const numerator = BigInt(String(frac)) * BigInt(String(weight));
	const increase = (numerator + POWERUP_FRACTION_DENOMINATOR - 1n) / POWERUP_FRACTION_DENOMINATOR;
	return Number(increase);
}

type PowerupResource = PowerUpState['cpu'] | PowerUpState['net'];

function powerupPriceFunction(resource: PowerupResource, utilization: number): number {
	const exponent = numberValue(resource.exponent);
	const newExponent = exponent - 1.0;

	if (newExponent <= 0.0) {
		return resource.max_price.value;
	}

	const utilizationWeight = utilization / Number(String(resource.weight));
	const difference = resource.max_price.value - resource.min_price.value;
	return resource.min_price.value + difference * Math.pow(utilizationWeight, newExponent);
}

function powerupPriceIntegralDelta(
	resource: PowerupResource,
	startUtilization: number,
	endUtilization: number
): number {
	const exponent = numberValue(resource.exponent);
	const weight = Number(String(resource.weight));
	const coefficient = (resource.max_price.value - resource.min_price.value) / exponent;
	const start = startUtilization / weight;
	const end = endUtilization / weight;

	return (
		resource.min_price.value * end -
		resource.min_price.value * start +
		coefficient * Math.pow(end, exponent) -
		coefficient * Math.pow(start, exponent)
	);
}

export function getPowerupResourceCost(resource: PowerupResource, frac: Int64): number {
	if (frac.lte(Int64.zero)) {
		return 0;
	}

	const utilizationIncrease = utilizationIncreaseForFraction(resource.weight, frac);
	let startUtilization = Number(String(resource.utilization));
	const endUtilization = startUtilization + utilizationIncrease;
	let adjustedUtilization = Number(String(resource.adjusted_utilization));
	let fee = 0;

	if (resource.utilization.lt(resource.adjusted_utilization)) {
		adjustedUtilization = Number(String(resource.determine_adjusted_utilization()));
	}

	if (startUtilization < adjustedUtilization) {
		const billedIncrease = Math.min(utilizationIncrease, adjustedUtilization - startUtilization);
		fee +=
			(powerupPriceFunction(resource, adjustedUtilization) * billedIncrease) /
			Number(String(resource.weight));
		startUtilization = adjustedUtilization;
	}

	if (startUtilization < endUtilization) {
		fee += powerupPriceIntegralDelta(resource, startUtilization, endUtilization);
	}

	return roundUpAssetValue(fee, assetPrecision(resource.max_price));
}

export function getMinimumBillablePowerupAmount(
	amount: Int64,
	required: boolean,
	minimumCost: number,
	getCost: (amount: number) => number,
	resource: 'cpu' | 'net'
): MinimumBillableAmountResult {
	if (!required || amount.lte(Int64.zero)) {
		return { amount, cost: 0 };
	}

	const evaluateCost = (candidateAmount: Int64) => {
		try {
			return getCost(Number(candidateAmount));
		} catch (error) {
			if (!isBelowPrecisionError(error)) {
				throw error;
			}

			return 0;
		}
	};

	let adjustedAmount = Int64.from(amount);
	let lowerBound = Int64.zero;
	let cost = 0;
	let attempts = 0;

	for (;;) {
		cost = evaluateCost(adjustedAmount);

		if (cost >= minimumCost) {
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

		lowerBound = adjustedAmount;
		adjustedAmount = adjustedAmount.multiplying(2);
		attempts += 1;
	}

	if (attempts > 0) {
		while (adjustedAmount.subtracting(lowerBound).gt(Int64.from(1))) {
			const midpoint = lowerBound.adding(adjustedAmount).dividing(2, 'floor');
			const midpointCost = evaluateCost(midpoint);

			if (midpointCost >= minimumCost) {
				adjustedAmount = midpoint;
				cost = midpointCost;
			} else {
				lowerBound = midpoint;
			}
		}
	}

	return { amount: adjustedAmount, cost };
}

export function getPowerupParamsCPU(
	ms: Int64,
	powerup: PowerUpState,
	sample: SampleUsage,
	requirements: AccountRequiredResources,
	minimumCost: number
) {
	const cpu_cost = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	const cpu_frac = Int64.from(0);
	if (requirements.cpuRequired) {
		const adjusted = getMinimumBillablePowerupAmount(
			ms,
			requirements.cpuRequired,
			minimumCost,
			(amount) => getPowerupResourceCost(powerup.cpu, powerup.cpu.frac_by_ms(sample, amount)),
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
	requirements: AccountRequiredResources,
	minimumCost: number
) {
	const net_cost = Asset.from(0, ANTELOPE_SYSTEM_TOKEN);
	const net_frac = Int64.from(0);
	if (requirements.netRequired) {
		const adjusted = getMinimumBillablePowerupAmount(
			kb,
			requirements.netRequired,
			minimumCost,
			(amount) => getPowerupResourceCost(powerup.net, powerup.net.frac_by_kb(sample, amount)),
			'net'
		);
		net_frac.add(powerup.net.frac_by_kb(sample, Number(adjusted.amount)));
		net_cost.units.add(Asset.fromFloat(adjusted.cost, ANTELOPE_SYSTEM_TOKEN).units);
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
	if (
		(requirements.cpuRequired || requirements.netRequired) &&
		max_payment.units.lt(powerup.min_powerup_fee.units)
	) {
		throw new Error(
			'Max payment ' +
				String(max_payment) +
				' is below the required minimum powerup fee target ' +
				String(powerup.min_powerup_fee) +
				'.'
		);
	}

	const feePrecisionUnit = 1 / Math.pow(10, assetPrecision(powerup.min_powerup_fee));
	const minimumCost = Math.min(powerup.min_powerup_fee.value + feePrecisionUnit, max_payment.value);

	const { cpu_cost, cpu_frac } = getPowerupParamsCPU(
		ms,
		powerup,
		sample,
		requirements,
		minimumCost
	);
	const { net_cost, net_frac } = getPowerupParamsNET(
		kb,
		powerup,
		sample,
		requirements,
		minimumCost
	);

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
