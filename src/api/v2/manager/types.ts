import { t } from 'elysia';

import { v2GenericResponse } from '$lib/types';

const tags = ['Resource Manager'];

export const v2ManagedAccountType = t.Object({
	account: t.String(),
	min_ms: t.Integer(),
	min_kb: t.Integer(),
	min_ram_kb: t.Optional(t.Integer()),
	inc_ms: t.Integer(),
	inc_kb: t.Integer(),
	inc_ram_kb: t.Optional(t.Integer()),
	max_fee: t.String()
});

export const v2ManagerResponseSuccess = t.Object(v2GenericResponse.properties, {
	description: 'Successful response from the manager service.'
});

export const v2ManagerList = {
	response: t.Array(v2ManagedAccountType),
	detail: {
		summary: 'List Accounts',
		description: 'List the accounts currently managed by this service.',
		tags
	}
};

export const v2ManagerAddBody = t.Object(v2ManagedAccountType.properties, {
	examples: [
		{
			account: 'test.gm',
			min_ms: 10,
			min_kb: 10,
			min_ram_kb: 10,
			inc_ms: 5,
			inc_kb: 5,
			inc_ram_kb: 5,
			max_fee: '0.1000 A'
		}
	]
});

export const v2ManagerAdd = {
	body: v2ManagerAddBody,
	detail: {
		summary: 'Add Account',
		description: 'Add an account to manage resources for on behalf of this service.',
		tags
	},
	response: {
		200: v2ManagerResponseSuccess
	}
};

export const v2ManagerRemoveBody = t.Object(
	{
		account: t.String()
	},
	{
		examples: [
			{
				account: 'test.gm'
			}
		]
	}
);

export const v2ManagerRemove = {
	body: v2ManagerRemoveBody,
	detail: {
		summary: 'Remove Account',
		description: 'Remove an account from the management services.',
		tags
	},
	response: {
		200: v2ManagerResponseSuccess
	}
};
