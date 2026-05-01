import { bearer } from '@elysiajs/bearer';
import { Elysia } from 'elysia';
import type { Static } from 'elysia';

import { guardAuthorization } from '../auth';

import { v2ManagerList, v2ManagerAdd, v2ManagerRemove } from './types';
import type { v2ManagerAddBody, v2ManagerRemoveBody, v2ManagerResponseSuccess } from './types';

import { managedAccounts } from '$lib/db/models/manager/account';
import { MANAGED_ACCOUNT_RAM_INCREMENT_KB, MANAGED_ACCOUNT_RAM_MINIMUM_KB } from 'src/config';

export async function addManagedAccount({
	body
}: {
	body: Static<typeof v2ManagerAddBody>;
}): Promise<Static<typeof v2ManagerResponseSuccess>> {
	await managedAccounts.addManagedAccount({
		account: body.account,
		min_ms: body.min_ms,
		min_kb: body.min_kb,
		min_ram_kb: body.min_ram_kb ?? MANAGED_ACCOUNT_RAM_MINIMUM_KB,
		inc_ms: body.inc_ms,
		inc_kb: body.inc_kb,
		inc_ram_kb: body.inc_ram_kb ?? MANAGED_ACCOUNT_RAM_INCREMENT_KB,
		max_fee: body.max_fee
	});
	return {
		code: 200,
		message: 'Account added for management'
	};
}

export async function removeManagedAccount({
	body
}: {
	body: Static<typeof v2ManagerRemoveBody>;
}): Promise<Static<typeof v2ManagerResponseSuccess>> {
	await managedAccounts.removeManagedAccount(body.account);
	return {
		code: 200,
		message: 'Account removed from management'
	};
}

export async function getManagedAccounts() {
	return managedAccounts.getManagedAccounts();
}

export const managed = new Elysia()
	.use(bearer())
	.get('/list', getManagedAccounts, v2ManagerList)
	.guard(guardAuthorization, (guarded) =>
		guarded
			.post('/add', addManagedAccount, v2ManagerAdd)
			.post('/remove', removeManagedAccount, v2ManagerRemove)
	);
