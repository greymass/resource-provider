import { Elysia, t } from 'elysia';

import {
	adminAccountParams,
	adminAuthResponses,
	adminManagedAccount,
	adminNotFound,
	adminSuccess,
	adminUnprocessable
} from './types';

import {
	addManagedAccount,
	listManagedAccounts,
	managedAccountAddBody,
	removeManagedAccount
} from '$lib/managed-accounts';

const tags = ['Admin'];

export const adminAccounts = new Elysia({ prefix: '/accounts' })
	.get('/', listManagedAccounts, {
		response: { 200: t.Array(adminManagedAccount), ...adminAuthResponses },
		detail: { summary: 'List Managed Accounts', tags }
	})
	.post(
		'/',
		async ({ body, set }) => {
			const result = await addManagedAccount(body);
			if (result.code === 422) set.status = 422;
			return result;
		},
		{
			body: managedAccountAddBody,
			response: { 200: adminSuccess, 422: adminUnprocessable, ...adminAuthResponses },
			detail: { summary: 'Add Managed Account', tags }
		}
	)
	.delete(
		'/:account',
		async ({ params, set }) => {
			const result = await removeManagedAccount(params.account);
			if (result.code === 404) {
				set.status = 404;
			}
			return result;
		},
		{
			params: adminAccountParams,
			response: {
				200: adminSuccess,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Remove Managed Account', tags }
		}
	);
