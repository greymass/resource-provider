import { Asset, PermissionLevel, UInt64 } from '@wharfkit/antelope';
import type { API } from '@wharfkit/antelope';
import type { SigningRequest } from '@wharfkit/signing-request';
import type { Static } from 'elysia';

import { v1ProviderRequestBody } from '$api/v1/types';
import type { v1ResponseTypes } from '$api/v1/types';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { providerLog } from '$lib/logger';
import { addFeeAction } from '$lib/wharf/actions/fee';
import { addNoopAction } from '$lib/wharf/actions/noop';
import { addBuyRAMBytesAction } from '$lib/wharf/actions/ram';
import { getClient } from '$lib/wharf/client';
import { getStaleContract, invalidateContractCache } from '$lib/wharf/contracts';
import { RAM_SAFETY_BUFFER_BYTES, computeResourceNeeds } from '$lib/wharf/estimation';
import type { ResourceNeeds } from '$lib/wharf/estimation';
import { calculateCosts, calculateTotalFee } from '$lib/wharf/pricing';
import { getProviderSession, signTransaction } from '$lib/wharf/session';
import { createSigningRequest, resolveTransaction } from '$lib/wharf/signing-request';
import {
	checkResourceSufficiency,
	resolvePermissionLevel,
	validateRequester
} from '$lib/wharf/validation';
import {
	ANTELOPE_SYSTEM_TOKEN,
	ENABLE_FREE_TRANSACTIONS,
	ENABLE_PAID_TRANSACTIONS,
	PROVIDER_FREE_TRANSACTIONS_LIMIT_KB,
	PROVIDER_FREE_TRANSACTIONS_LIMIT_MS,
	PROVIDER_PAID_TRANSACTIONS_FEE_DEFAULT_REF,
	PROVIDER_PAID_TRANSACTIONS_FEE_MEMO,
	PROVIDER_PAID_TRANSACTIONS_FEE_RECIPIENT
} from 'src/config';

function validateRequest(cosigner: PermissionLevel, request: SigningRequest): void {
	const actions = request.getRawActions();
	providerLog.debug('Validating request actions', { actionCount: actions.length });

	if (request.isIdentity()) {
		throw new Error('Identity requests are not allowed.');
	}

	if (
		actions.some((action) => action.authorization.some((auth) => auth.actor.equals(cosigner.actor)))
	) {
		throw new Error('Actions cannot contain the authority of the cosigner.');
	}
}

async function checkQuota(account: string, resourceNeeds: ResourceNeeds): Promise<boolean> {
	if (!ENABLE_FREE_TRANSACTIONS) {
		return false;
	}

	const currentUsage = await usageDatabase.getUsage(account);
	const cpuLimit = Number(PROVIDER_FREE_TRANSACTIONS_LIMIT_MS) * 1000;
	const netLimit = Number(PROVIDER_FREE_TRANSACTIONS_LIMIT_KB) * 1000;

	const projectedCpu = currentUsage.cpu + resourceNeeds.cpu;
	const projectedNet = currentUsage.net + resourceNeeds.net;

	const withinQuota = projectedCpu <= cpuLimit && projectedNet <= netLimit;

	providerLog.debug('Quota check', {
		account,
		currentUsage,
		resourceNeeds,
		limits: { cpu: cpuLimit, net: netLimit },
		withinQuota
	});

	return withinQuota;
}

async function processRequest(
	request: SigningRequest,
	requester: PermissionLevel,
	cosigner: PermissionLevel,
	ref?: string
): Promise<v1ResponseTypes> {
	let accountData: API.v1.AccountObject;
	try {
		accountData = await getClient().v1.chain.get_account(requester.actor);
	} catch {
		throw new Error(`Unable to retrieve account data for ${requester.actor}.`);
	}
	providerLog.debug('Account data retrieved', { account: String(requester.actor) });

	checkResourceSufficiency(accountData);
	providerLog.debug('Resource sufficiency check passed');

	let transaction = await resolveTransaction(request, requester);
	providerLog.debug('Transaction resolved', { actions: transaction.actions.length });

	transaction = await addNoopAction(transaction, cosigner);
	providerLog.debug('Noop action added');

	const resourceNeeds = await computeResourceNeeds(transaction);
	providerLog.debug('Resource needs computed', resourceNeeds);

	if (resourceNeeds.ram > 0) {
		const ramBytes = UInt64.from(resourceNeeds.ram + RAM_SAFETY_BUFFER_BYTES);
		transaction = await addBuyRAMBytesAction(transaction, requester, ramBytes);
	}

	const withinQuota = await checkQuota(String(requester.actor), resourceNeeds);

	if (withinQuota) {
		providerLog.debug('Within free quota, signing transaction');
		const providerSignature = await signTransaction(transaction);
		await usageDatabase.incrementUsage(
			String(requester.actor),
			resourceNeeds.cpu,
			resourceNeeds.net
		);

		providerLog.info('Provided resources (free)', {
			account: String(requester.actor),
			cpu: resourceNeeds.cpu,
			net: resourceNeeds.net
		});
		return {
			code: 200,
			data: {
				request: ['transaction', transaction],
				resources: { cpu: resourceNeeds.cpu, net: resourceNeeds.net, ram: resourceNeeds.ram },
				signatures: [String(providerSignature)]
			}
		};
	}

	if (!ENABLE_PAID_TRANSACTIONS) {
		throw new Error(
			ENABLE_FREE_TRANSACTIONS
				? 'Free transaction quota exceeded.'
				: 'Resource provider is not accepting requests at this time.'
		);
	}

	providerLog.debug('Exceeds free quota, calculating paid costs');
	const costs = await calculateCosts(resourceNeeds);
	const totalFee = calculateTotalFee(costs);
	const providerFee = calculateTotalFee({
		cpu: costs.cpu,
		net: costs.net,
		ram: Asset.from(0, ANTELOPE_SYSTEM_TOKEN)
	});
	providerLog.debug('Fee calculated', { fee: String(totalFee), providerFee: String(providerFee) });

	const feeRef = ref || PROVIDER_PAID_TRANSACTIONS_FEE_DEFAULT_REF;
	const feeMemo = feeRef
		? `${PROVIDER_PAID_TRANSACTIONS_FEE_MEMO} | ref=${feeRef}`
		: PROVIDER_PAID_TRANSACTIONS_FEE_MEMO;

	transaction = await addFeeAction(
		transaction,
		requester,
		PROVIDER_PAID_TRANSACTIONS_FEE_RECIPIENT || cosigner.actor,
		providerFee,
		feeMemo
	);

	const providerSignature = await signTransaction(transaction);

	providerLog.info('Provided resources (paid)', {
		account: String(requester.actor),
		cpu: resourceNeeds.cpu,
		net: resourceNeeds.net,
		fee: String(providerFee)
	});
	return {
		code: 402,
		data: {
			costs: {
				cpu: String(costs.cpu),
				net: String(costs.net),
				ram: String(costs.ram)
			},
			fee: String(totalFee),
			request: ['transaction', transaction],
			resources: { cpu: resourceNeeds.cpu, net: resourceNeeds.net, ram: resourceNeeds.ram },
			signatures: [String(providerSignature)]
		}
	};
}

export async function request({
	body
}: {
	body: Static<typeof v1ProviderRequestBody>;
}): Promise<v1ResponseTypes> {
	const signingRequest = await createSigningRequest(body);
	const requester = resolvePermissionLevel(body.signer);
	const session = await getProviderSession();
	const cosigner = session.permissionLevel;

	providerLog.debug('Processing request', {
		requester: String(requester),
		cosigner: String(cosigner)
	});

	validateRequest(cosigner, signingRequest);
	validateRequester(cosigner, requester);

	try {
		return await processRequest(signingRequest, requester, cosigner, body.ref);
	} catch (error) {
		const staleContract = getStaleContract(error);
		if (!staleContract) {
			providerLog.error('Request failed', { error: String(error) });
			throw error;
		}
		providerLog.warn('Stale ABI detected, retrying with fresh contract', {
			error: String(error),
			contract: staleContract
		});
		invalidateContractCache(staleContract);
		return processRequest(signingRequest, requester, cosigner, body.ref);
	}
}
