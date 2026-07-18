import { t } from 'elysia';

import { apiNotFound, apiSuccess, apiUnauthorized, apiUnprocessable } from '$lib/api-types';
import {
	managedAccountAddBody,
	managedAccountRemoveBody,
	managedAccountSchema
} from '$lib/managed-accounts';

const tags = ['Resource Manager'];

export const v2ManagedAccountType = managedAccountSchema;

export const v2ManagerResponseSuccess = apiSuccess;

export const v2ManagerList = {
	response: { 200: t.Array(v2ManagedAccountType), 401: apiUnauthorized },
	detail: {
		summary: 'List Accounts',
		description: 'List the accounts currently managed by this service.',
		tags
	}
};

export const v2ManagerAddBody = managedAccountAddBody;

export const v2ManagerAdd = {
	body: v2ManagerAddBody,
	detail: {
		summary: 'Add Account',
		description: 'Add an account to manage resources for on behalf of this service.',
		tags
	},
	response: {
		200: v2ManagerResponseSuccess,
		401: apiUnauthorized,
		422: apiUnprocessable
	}
};

export const v2ManagerRemoveBody = managedAccountRemoveBody;

export const v2ManagerRemove = {
	body: v2ManagerRemoveBody,
	detail: {
		summary: 'Remove Account',
		description: 'Remove an account from the management services.',
		tags
	},
	response: {
		200: v2ManagerResponseSuccess,
		401: apiUnauthorized,
		404: apiNotFound,
		422: apiUnprocessable
	}
};
