import { bearer } from '@elysiajs/bearer';
import { Elysia } from 'elysia';
import type { Context, Static } from 'elysia';

import { guardAuthorization } from '../auth';

import { v2ManagerList, v2ManagerAdd, v2ManagerRemove } from './types';
import type { v2ManagerAddBody, v2ManagerRemoveBody } from './types';

import { typedValidationResponse } from '$lib/http';
import {
	addManagedAccount as addCanonicalManagedAccount,
	listManagedAccounts,
	removeManagedAccount as removeCanonicalManagedAccount
} from '$lib/managed-accounts';

export async function addManagedAccount({
	body,
	set
}: {
	body: Static<typeof v2ManagerAddBody>;
	set?: Context['set'];
}) {
	const result = await addCanonicalManagedAccount(body);
	if (result.code === 422 && set) set.status = 422;
	return result;
}

export async function removeManagedAccount({
	body,
	set
}: {
	body: Static<typeof v2ManagerRemoveBody>;
	set?: Context['set'];
}) {
	const result = await removeCanonicalManagedAccount(body.account);
	if (result.code === 404 && set) {
		set.status = 404;
	}
	return result;
}

export async function getManagedAccounts() {
	return listManagedAccounts();
}

export const managed = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === 'VALIDATION') return typedValidationResponse(error, set);
	})
	.use(bearer())
	.guard(guardAuthorization, (guarded) =>
		guarded
			.get('/list', getManagedAccounts, v2ManagerList)
			.post('/add', addManagedAccount, v2ManagerAdd)
			.post('/remove', removeManagedAccount, v2ManagerRemove)
	);
