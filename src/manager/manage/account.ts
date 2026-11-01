import { Int64 } from '@wharfkit/antelope';
import { Session } from '@wharfkit/session';
import { Static } from 'elysia';

import { ManagerContext } from '../context';

import { v2ManagedAccountType } from '$api/v2/manager/types';
import { ManagedAccount } from '$lib/db/models/manager/account';
import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import { getPowerupParams } from '$lib/wharf/actions/powerup';
import { getClient } from '$lib/wharf/client';
import { getContract } from '$lib/wharf/contracts';
import { inPowerupCooldown, recordPowerup } from '$lib/wharf/cooldown';
import { getRequiredResourcesWithRenewals } from '$lib/wharf/leases';
import { getPurchaseAmounts } from '$lib/wharf/resources';
import { ANTELOPE_SYSTEM_CONTRACT } from 'src/config';

export async function manageAccountResources(
	manager: Session,
	account: Static<typeof v2ManagedAccountType>,
	context: ManagerContext
) {
	try {
		const managed = ManagedAccount.from(account);
		const data = await getClient().v1.chain.get_account(managed.account);
		if (inPowerupCooldown(String(managed.account))) {
			managerLog.debug('powerup cooldown active, skipping', { account: String(managed.account) });
			return;
		}
		const requiredResources = await getRequiredResourcesWithRenewals(managed, data);
		const amounts = getPurchaseAmounts(managed, data, requiredResources);
		const params = getPowerupParams(
			amounts.ms,
			amounts.kb,
			context.powerup,
			context.sampleUsage,
			requiredResources,
			manager.actor,
			managed.account,
			managed.max_fee
		);
		if (params.cpu_frac.gt(Int64.zero) || params.net_frac.gt(Int64.zero)) {
			const systemContract = await getContract(ANTELOPE_SYSTEM_CONTRACT);
			const action = await systemContract.action('powerup', params);
			managerLog.debug(
				'powerup action to perform',
				objectify({ account: managed.account, action, params })
			);
			const result = await manager.transact({ action });
			if (!result.resolved) {
				managerLog.error(
					'account management transaction failed with no result',
					objectify({ managed, result })
				);
				return;
			}
			recordPowerup(String(managed.account));
			managerLog.info(
				'powerup successful',
				objectify({
					account: managed.account,
					trx_id: String(result.resolved?.transaction.id)
				})
			);
		} else {
			managerLog.debug(
				'no powerup required',
				objectify({
					account: managed.account
				})
			);
		}
	} catch (error) {
		managerLog.error('manageAccountResources failed', { account, error: String(error) });
	}
}
