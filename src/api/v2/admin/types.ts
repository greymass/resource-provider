import { t } from 'elysia';

import {
	apiConflict,
	apiForbidden,
	apiNotFound,
	apiSuccess,
	apiUnauthorized,
	apiUnprocessable
} from '$lib/api-types';
import { managedAccountSchema } from '$lib/managed-accounts';

const closed = { additionalProperties: false } as const;

export const adminUnauthorized = apiUnauthorized;
export const adminForbidden = apiForbidden;
export const adminNotFound = apiNotFound;
export const adminConflict = apiConflict;
export const adminUnprocessable = apiUnprocessable;
export const adminSuccess = apiSuccess;

export const adminAuthResponses = { 401: adminUnauthorized };
export const adminPlatformResponses = { 401: adminUnauthorized, 403: adminForbidden };

export const adminNameParams = t.Object({ name: t.String() }, closed);
export const adminAccountParams = t.Object({ account: t.String() }, closed);

export const adminTokenInfo = t.Object(
	{
		name: t.String(),
		level: t.Union([t.Literal('platform'), t.Literal('app')]),
		created_at: t.Integer(),
		last_used_at: t.Union([t.Integer(), t.Null()])
	},
	closed
);

export const adminTokenCreateBody = t.Object(
	{
		name: t.String(),
		level: t.Union([t.Literal('platform'), t.Literal('app')])
	},
	closed
);

export const adminTokenCreated = t.Object(
	{
		name: t.String(),
		level: t.Union([t.Literal('platform'), t.Literal('app')]),
		token: t.String()
	},
	closed
);

export const adminBucket = t.Object(
	{
		name: t.String(),
		priority: t.Integer({ minimum: 0 }),
		limit_ms: t.Integer({ minimum: 1 }),
		limit_kb: t.Integer({ minimum: 1 }),
		members: t.Integer({ minimum: 0 })
	},
	closed
);

export const adminBucketBody = t.Object(
	{
		priority: t.Integer({ minimum: 0 }),
		limit_ms: t.Integer({ minimum: 1 }),
		limit_kb: t.Integer({ minimum: 1 })
	},
	closed
);

export const adminRule = t.Object(
	{
		name: t.String(),
		bucket: t.String(),
		allow: t.Array(t.String()),
		require: t.Array(t.String())
	},
	closed
);

export const adminRuleBody = t.Object(
	{
		bucket: t.String(),
		allow: t.Array(t.String()),
		require: t.Array(t.String())
	},
	closed
);

export const adminSetting = t.Object(
	{
		key: t.String(),
		type: t.Union([
			t.Literal('integer'),
			t.Literal('boolean'),
			t.Literal('string'),
			t.Literal('asset')
		]),
		description: t.String(),
		default: t.Union([t.String(), t.Null()]),
		value: t.Union([t.String(), t.Null()]),
		set: t.Boolean()
	},
	closed
);

const settingValue = t.Union([t.String(), t.Null()]);

export const adminSettingsBody = t.Record(t.String(), settingValue);

export const adminSettingsBatchError = t.Object({ key: t.String(), error: t.String() }, closed);

export const adminSettingsInvalid = t.Object(
	{
		code: t.Literal(422),
		message: t.String(),
		errors: t.Array(adminSettingsBatchError)
	},
	closed
);

export const adminManagedAccount = managedAccountSchema;

export const adminUsageRow = t.Object(
	{
		account: t.String(),
		bucket: t.String(),
		cpu: t.Integer(),
		net: t.Integer()
	},
	closed
);

export const adminUsagePage = t.Object(
	{
		window_hours: t.Integer({ minimum: 1 }),
		usage: t.Array(adminUsageRow),
		next_cursor: t.Union([t.String(), t.Null()])
	},
	closed
);

export const adminUsageQuery = t.Object(
	{
		limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000, multipleOf: 1 })),
		cursor: t.Optional(t.String()),
		account: t.Optional(t.String()),
		bucket: t.Optional(t.String())
	},
	closed
);

export const adminMemberRow = t.Object({ account: t.String() }, closed);

export const adminMemberPage = t.Object(
	{
		accounts: t.Array(adminMemberRow),
		next_cursor: t.Union([t.String(), t.Null()])
	},
	closed
);

export const adminMemberQuery = t.Object(
	{
		limit: t.Optional(t.Numeric({ minimum: 1, maximum: 1000, multipleOf: 1 })),
		cursor: t.Optional(t.String())
	},
	closed
);

export const adminAccountsBody = t.Object(
	{ accounts: t.Array(t.String(), { minItems: 1, maxItems: 5000 }) },
	closed
);

export const adminBulkAddResult = t.Object(
	{ added: t.Integer(), ignored: t.Integer(), members: t.Integer() },
	closed
);

export const adminBulkRemoveResult = t.Object(
	{ removed: t.Integer(), empty: t.Boolean(), members: t.Integer(), message: t.String() },
	closed
);

export const adminMembership = t.Object({ bucket: t.String() }, closed);

export const adminMemberParams = t.Object({ name: t.String(), account: t.String() }, closed);
