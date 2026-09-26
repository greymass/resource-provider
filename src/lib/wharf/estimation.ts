import type { API } from '@wharfkit/antelope';
import { Asset, Transaction } from '@wharfkit/antelope';

import { providerLog } from '$lib/logger';
import { getClient } from '$lib/wharf/client';

export interface ResourceNeeds {
	cpu: number;
	net: number;
	ram: number;
}

export interface ResourceCosts {
	cpu: Asset;
	net: Asset;
	ram: Asset;
}

export const RAM_SAFETY_BUFFER_BYTES = 50;

export function cpuMedian(samples: API.v1.SendTransactionResponse[]): number {
	const estimates = samples.map((s) => s.processed.elapsed).sort((a, b) => a - b);
	const middle = Math.floor(estimates.length / 2);
	return estimates.length % 2 !== 0
		? estimates[middle]
		: Math.floor((estimates[middle - 1] + estimates[middle]) / 2);
}

export function determineResourceNeeds(samples: API.v1.SendTransactionResponse[]): ResourceNeeds {
	const cpu = cpuMedian(samples);
	const net = samples[0].processed.net_usage;
	let ram = 0;
	const exception = samples[0].processed.except;
	if (exception && exception.name) {
		switch (exception.name) {
			case 'ram_usage_exceeded': {
				const data: {
					account: string;
					needs: number;
					available: number;
				} = exception.stack[0].data;
				const { available, needs } = data;
				ram = needs - available;
				break;
			}
			default: {
				const frame = exception.stack?.[0];
				let detail = frame?.format ?? exception.message;
				if (frame?.data) {
					for (const [key, value] of Object.entries(frame.data)) {
						detail = detail.replace(`\${${key}}`, String(value));
					}
				}
				providerLog.debug('compute_transaction exception', {
					name: exception.name,
					message: exception.message,
					stack: exception.stack
				});
				throw new Error(`${exception.name}: ${detail}`);
			}
		}
	}
	return { cpu, net, ram };
}

export async function computeResourceNeeds(
	transaction: Transaction,
	iterations = 5
): Promise<ResourceNeeds> {
	const samples = await Promise.all(
		[...Array(iterations)].map(() => getClient().v1.chain.compute_transaction(transaction))
	);
	return determineResourceNeeds(samples);
}
