import { Action, Int64 } from '@wharfkit/antelope';
import { Session } from '@wharfkit/session';
import { Static } from 'elysia';

import { ManagerContext } from '../context';

import { v2ManagedAccountType } from '$api/v2/manager/types';
import { ManagedAccount } from '$lib/db/models/manager/account';
import { managerLog } from '$lib/logger';
import { makeBuyRamBytesAction } from '$lib/manager/setup';
import { objectify } from '$lib/utils';
import { getPowerupParams } from '$lib/wharf/actions/powerup';
import { getClient } from '$lib/wharf/client';
import { getContract } from '$lib/wharf/contracts';
import { getAccountRequiredResources } from '$lib/wharf/resources';
import { ANTELOPE_SYSTEM_CONTRACT } from 'src/config';

export async function manageAccountResources(
	manager: Session,
	account: Static<typeof v2ManagedAccountType>,
	context: ManagerContext
) {
	try {
		const managed = ManagedAccount.from({
			min_ram_kb: 0,
			inc_ram_kb: 0,
			...account
		});
		const data = await getClient().v1.chain.get_account(managed.account);
		const requiredResources = getAccountRequiredResources(managed, data);
		const actions: Action[] = [];
		const params = getPowerupParams(
			managed.inc_ms,
			managed.inc_kb,
			context.powerup,
			context.sampleUsage,
			requiredResources,
			manager.actor,
			managed.account,
			managed.max_fee
		);
		if (params.cpu_frac.gt(Int64.zero) || params.net_frac.gt(Int64.zero)) {
			const systemContract = await getContract(ANTELOPE_SYSTEM_CONTRACT);
			const action = await systemContract.action('powerup', params, {
				authorization: [manager.permissionLevel]
			});
			managerLog.debug(
				'powerup action to perform',
				objectify({ account: managed.account, action, params })
			);
			actions.push(action);
		}
		if (requiredResources.ramRequired) {
			const bytes = managed.inc_ram_kb.multiplying(1000);
			const action = await makeBuyRamBytesAction(manager, managed.account, bytes);
			managerLog.debug(
				'buyrambytes action to perform',
				objectify({ account: managed.account, action, bytes })
			);
			actions.push(action);
		}
		if (actions.length) {
			const result = await manager.transact({ actions });
			if (!result.resolved) {
				managerLog.error(
					'account management transaction failed with no result',
					objectify({ managed, result })
				);
				return;
			}
			managerLog.info(
				'account management transaction successful',
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
