import { Elysia, t } from 'elysia';

import {
	adminAccountsBody,
	adminAuthResponses,
	adminBulkAddResult,
	adminBulkRemoveResult,
	adminMemberPage,
	adminMemberParams,
	adminMemberQuery,
	adminMemberRow,
	adminMembership,
	adminNameParams,
	adminNotFound,
	adminUnprocessable
} from './types';

import { accessDatabase, isValidAccountName } from '$lib/db/models/provider/access';
import { policyDatabase } from '$lib/db/models/provider/policy';

const tags = ['Admin'];

function decodeCursor(raw: string): string | undefined {
	const account = Buffer.from(raw, 'base64url').toString();
	return isValidAccountName(account) ? account : undefined;
}

function encodeCursor(account: string): string {
	return Buffer.from(account).toString('base64url');
}

type ResponseStatus = { status?: number | string };

function unknownBucket(name: string, set: ResponseStatus) {
	if (policyDatabase.getBucket(name)) return undefined;
	set.status = 404;
	return { code: 404 as const, message: `Unknown bucket '${name}'` };
}

function invalidAccounts(accounts: string[], set: ResponseStatus) {
	const invalid = accounts.filter((account) => !isValidAccountName(account));
	if (invalid.length === 0) return undefined;
	set.status = 422;
	return { code: 422 as const, message: `Invalid account names: ${invalid.join(', ')}` };
}

export const adminAccess = new Elysia()
	.get(
		'/buckets/:name/accounts',
		({ params, query, set }) => {
			const missing = unknownBucket(params.name, set);
			if (missing) return missing;
			const rawCursor = query.cursor;
			const after = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
			if (rawCursor !== undefined && after === undefined) {
				set.status = 422;
				return { code: 422 as const, message: 'Invalid cursor' };
			}
			const result = accessDatabase.list(params.name, query.limit ?? 100, after);
			return {
				accounts: result.accounts,
				next_cursor: result.next ? encodeCursor(result.next) : null
			};
		},
		{
			params: adminNameParams,
			query: adminMemberQuery,
			response: {
				200: adminMemberPage,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'List Bucket Members (cursor paginated)', tags }
		}
	)
	.post(
		'/buckets/:name/accounts',
		({ params, body, set }) => {
			const invalid = unknownBucket(params.name, set) ?? invalidAccounts(body.accounts, set);
			if (invalid) return invalid;
			const result = accessDatabase.add(params.name, body.accounts);
			return { ...result, members: accessDatabase.count(params.name) };
		},
		{
			params: adminNameParams,
			body: adminAccountsBody,
			response: {
				200: adminBulkAddResult,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Add Bucket Members (bulk)', tags }
		}
	)
	.post(
		'/buckets/:name/accounts/remove',
		({ params, body, set }) => {
			const invalid = unknownBucket(params.name, set) ?? invalidAccounts(body.accounts, set);
			if (invalid) return invalid;
			const result = accessDatabase.remove(params.name, body.accounts);
			return {
				...result,
				members: accessDatabase.count(params.name),
				message: result.empty
					? `Access list empty — bucket ${params.name} is now OPEN to all accounts`
					: `Removed ${result.removed} account(s) from bucket ${params.name}`
			};
		},
		{
			params: adminNameParams,
			body: adminAccountsBody,
			response: {
				200: adminBulkRemoveResult,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Remove Bucket Members (bulk)', tags }
		}
	)
	.get(
		'/buckets/:name/accounts/:account',
		({ params, set }) => {
			const missing = unknownBucket(params.name, set);
			if (missing) return missing;
			if (!accessDatabase.has(params.name, params.account)) {
				set.status = 404;
				return {
					code: 404 as const,
					message: `Account '${params.account}' is not a member of bucket '${params.name}'`
				};
			}
			return { account: params.account };
		},
		{
			params: adminMemberParams,
			response: { 200: adminMemberRow, 404: adminNotFound, ...adminAuthResponses },
			detail: { summary: 'Check Bucket Membership', tags }
		}
	)
	.get('/access/:account', ({ params }) => accessDatabase.bucketsForAccount(params.account), {
		params: t.Object({ account: t.String() }, { additionalProperties: false }),
		response: { 200: t.Array(adminMembership), ...adminAuthResponses },
		detail: { summary: 'List Bucket Memberships for Account', tags }
	});
