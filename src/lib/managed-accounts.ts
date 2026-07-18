import { Asset, Name } from '@wharfkit/antelope';
import { t } from 'elysia';
import type { Static } from 'elysia';

import { ManagedAccount, managedAccounts } from '$lib/db/models/manager/account';

const closed = { additionalProperties: false } as const;

export const managedAccountSchema = t.Object(
	{
		account: t.String(),
		min_ms: t.Integer(),
		min_kb: t.Integer(),
		inc_ms: t.Integer(),
		inc_kb: t.Integer(),
		max_fee: t.String()
	},
	closed
);

export const managedAccountAddBody = t.Object(managedAccountSchema.properties, {
	...closed,
	examples: [
		{
			account: 'test.gm',
			min_ms: 10,
			min_kb: 10,
			inc_ms: 5,
			inc_kb: 5,
			max_fee: '0.1000 A'
		}
	]
});

export const managedAccountRemoveBody = t.Object(
	{ account: t.String() },
	{
		...closed,
		examples: [{ account: 'test.gm' }]
	}
);

export type ManagedAccountDTO = Static<typeof managedAccountSchema>;

export async function listManagedAccounts(): Promise<ManagedAccountDTO[]> {
	return managedAccounts.getManagedAccounts();
}

export async function addManagedAccount(input: ManagedAccountDTO) {
	let account: ManagedAccount;
	try {
		if (
			input.account.length === 0 ||
			!Name.pattern.test(input.account) ||
			String(Name.from(input.account)) !== input.account
		) {
			throw new Error('Invalid Antelope account name');
		}
		if (String(Asset.from(input.max_fee)) !== input.max_fee) {
			throw new Error('Invalid Antelope asset');
		}
		account = ManagedAccount.from(input);
	} catch {
		return { code: 422 as const, message: 'Invalid managed account input' };
	}

	await managedAccounts.addManagedAccount(account);
	return { code: 200 as const, message: 'Account added for management' };
}

export async function removeManagedAccount(account: string) {
	const removed = await managedAccounts.removeManagedAccount(account);
	return removed
		? { code: 200 as const, message: 'Account removed from management' }
		: { code: 404 as const, message: `Unknown managed account '${account}'` };
}
