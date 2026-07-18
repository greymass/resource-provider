import { Elysia } from 'elysia';

import { adminAuthResponses, adminUnprocessable, adminUsagePage, adminUsageQuery } from './types';

import { usageDatabase } from '$lib/db/models/provider/usage';
import { getInt } from '$lib/settings';

const tags = ['Admin'];

function decodeCursor(raw: string): { account: string; bucket: string } | undefined {
	try {
		const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString());
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			'account' in parsed &&
			'bucket' in parsed &&
			typeof parsed.account === 'string' &&
			typeof parsed.bucket === 'string'
		) {
			return { account: parsed.account, bucket: parsed.bucket };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function encodeCursor(cursor: { account: string; bucket: string }): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export const adminUsage = new Elysia({ prefix: '/usage' }).get(
	'/',
	({ query, set }) => {
		const limit = query.limit ?? 100;

		const rawCursor = query.cursor;
		const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);
		if (rawCursor !== undefined && !cursor) {
			set.status = 422;
			return { code: 422 as const, message: 'Invalid cursor' };
		}

		const result = usageDatabase.listUsage({
			limit,
			cursor,
			account: query.account,
			bucket: query.bucket
		});
		return {
			window_hours: getInt('provider.usage.window_hours'),
			usage: result.rows,
			next_cursor: result.next ? encodeCursor(result.next) : null
		};
	},
	{
		query: adminUsageQuery,
		response: { 200: adminUsagePage, 422: adminUnprocessable, ...adminAuthResponses },
		detail: { summary: 'List Usage (cursor paginated)', tags }
	}
);
