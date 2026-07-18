import { Asset, PermissionLevel, UInt64 } from '@wharfkit/antelope';
import type { API } from '@wharfkit/antelope';
import type { SigningRequest } from '@wharfkit/signing-request';
import type { Static } from 'elysia';

import { v1ProviderRequestBody } from '$api/v1/types';
import type { v1ResponseTypes } from '$api/v1/types';
import { accessDatabase } from '$lib/db/models/provider/access';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { providerLog } from '$lib/logger';
import { loadPolicy, resolveFreeGrant } from '$lib/rules';
import { getString } from '$lib/settings';
import { addFeeAction } from '$lib/wharf/actions/fee';
import { addNoopAction } from '$lib/wharf/actions/noop';
import { addBuyRAMBytesAction } from '$lib/wharf/actions/ram';
import { getClient } from '$lib/wharf/client';
import { getStaleContract, invalidateContractCache } from '$lib/wharf/contracts';
import { RAM_SAFETY_BUFFER_BYTES, computeResourceNeeds } from '$lib/wharf/estimation';
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
	ENABLE_PAID_TRANSACTIONS
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

	if (actions.some((action) => action.authorization.length === 0)) {
		throw new Error('Actions must contain at least one authorization.');
	}
}

async function processRequest(
	request: SigningRequest,
	requester: PermissionLevel,
	cosigner: PermissionLevel,
	ref?: string
): Promise<v1ResponseTypes> {
	let transaction = await resolveTransaction(request, requester);
	providerLog.debug('Transaction resolved', { actions: transaction.actions.length });

	const userActions = transaction.actions;
	if (userActions.length === 0 || userActions[0].authorization.length === 0) {
		throw new Error('Transaction has no billable actions.');
	}
	const sufficiencySubject = userActions[0].authorization[0].actor;

	let accountData: API.v1.AccountObject;
	try {
		accountData = await getClient().v1.chain.get_account(sufficiencySubject);
	} catch {
		throw new Error(`Unable to retrieve account data for ${sufficiencySubject}.`);
	}
	checkResourceSufficiency(accountData);
	providerLog.debug('Resource sufficiency check passed');

	const matchActions = userActions.map((action) => ({
		account: String(action.account),
		name: String(action.name)
	}));
	const billed = [
		...new Set(
			userActions.flatMap((action) => action.authorization.map((auth) => String(auth.actor)))
		)
	];

	transaction = await addNoopAction(transaction, cosigner);
	providerLog.debug('Noop action added');

	const resourceNeeds = await computeResourceNeeds(transaction);
	providerLog.debug('Resource needs computed', resourceNeeds);

	if (resourceNeeds.ram > 0) {
		const ramBytes = UInt64.from(resourceNeeds.ram + RAM_SAFETY_BUFFER_BYTES);
		transaction = await addBuyRAMBytesAction(transaction, requester, ramBytes);
	}

	const grant = ENABLE_FREE_TRANSACTIONS
		? resolveFreeGrant(
				loadPolicy(),
				matchActions,
				{ cpu: resourceNeeds.cpu, net: resourceNeeds.net },
				billed,
				(account, bucket) => usageDatabase.getBucketUsage(account, bucket),
				(account, bucket) =>
					!accessDatabase.isRestricted(bucket) || accessDatabase.has(bucket, account)
			)
		: null;

	if (grant) {
		providerLog.debug('Free grant resolved', { grant });
		const providerSignature = await signTransaction(transaction);
		for (const { account, bucket } of grant) {
			await usageDatabase.incrementUsage(account, resourceNeeds.cpu, resourceNeeds.net, bucket);
		}
		providerLog.info('Provided resources (free)', {
			account: String(requester.actor),
			cpu: resourceNeeds.cpu,
			net: resourceNeeds.net,
			buckets: grant
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

	const feeRef = ref || getString('provider.paid_transactions.fee_default_ref');
	const feeMemoBase = getString('provider.paid_transactions.fee_memo')!;
	const feeMemo = feeRef ? `${feeMemoBase} | ref=${feeRef}` : feeMemoBase;

	transaction = await addFeeAction(
		transaction,
		requester,
		getString('provider.paid_transactions.fee_recipient') || cosigner.actor,
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
