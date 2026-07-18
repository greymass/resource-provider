import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { adminServer, mountAdminRoutes } from '../src/admin';
import { admin } from '../src/api/v2/admin';
import { managed } from '../src/api/v2/manager';
import {
	defaultPaidTransactions,
	ENABLE_ADMIN_API,
	ENABLE_RESOURCE_MANAGER,
	ENABLE_RESOURCE_PROVIDER
} from '../src/config';

import { database } from '$lib/db';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { tokensDatabase } from '$lib/db/models/provider/tokens';
import { usageDatabase } from '$lib/db/models/provider/usage';
import * as schema from '$lib/db/schema';
import { withGlobalErrorHandling } from '$lib/http';
import type { ManagedAccountDTO } from '$lib/managed-accounts';
import { invalidatePolicyCache, loadPolicy } from '$lib/rules';
import { getInt } from '$lib/settings';

describe('admin server gating', () => {
	(ENABLE_ADMIN_API ? it.skip : it)('does not mount when ENABLE_ADMIN_API is false', () => {
		expect(adminServer()).toBeUndefined();
	});

	it('defaults paid transactions to the resource provider flag', () => {
		expect(defaultPaidTransactions(false)).toBeFalse();
		expect(defaultPaidTransactions(true)).toBeTrue();
	});

	it('mounts Admin routes on a local app without provider or manager routes', async () => {
		const local = mountAdminRoutes(new Elysia());
		expect((await local.handle(adminRequest('/accounts'))).status).toBe(401);
		expect(
			(await local.handle(new Request('http://localhost/v2/resource/manager/list'))).status
		).toBe(404);
		expect((await local.handle(new Request('http://localhost/v1/resource_provider'))).status).toBe(
			404
		);
		expect(typeof ENABLE_RESOURCE_MANAGER).toBe('boolean');
		expect(typeof ENABLE_RESOURCE_PROVIDER).toBe('boolean');
	});
});

export function makeAdminApp() {
	return new Elysia().group('/v2', (root) => root.group('/admin', (g) => g.use(admin)));
}

function makeProductionOrderedApp() {
	return withGlobalErrorHandling(new Elysia())
		.group('/v2', (root) =>
			root
				.group('/admin', (g) => g.use(admin))
				.group('/resource', (resource) => resource.group('/manager', (g) => g.use(managed)))
		)
		.post('/legacy-validation', ({ body }) => body, {
			body: t.Object({ value: t.String() })
		});
}

export function adminRequest(path: string, token?: string, method = 'GET', body?: unknown) {
	return new Request(`http://localhost/v2/admin${path}`, {
		method,
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
}

let app: Elysia;
let appToken: string;
let platformToken: string;

beforeAll(() => {
	app = makeAdminApp();
	appToken = tokensDatabase.create('test-admin-app', 'app');
	platformToken = tokensDatabase.create('test-admin-platform', 'platform');
});

afterAll(() => {
	tokensDatabase.remove('test-admin-app');
	tokensDatabase.remove('test-admin-platform');
});

describe('admin token endpoints', () => {
	it('requires a token at all', async () => {
		expect((await app.handle(adminRequest('/tokens'))).status).toBe(401);
	});
	it('requires platform level', async () => {
		expect((await app.handle(adminRequest('/tokens', appToken))).status).toBe(403);
	});
	it('lists tokens without hashes', async () => {
		const response = await app.handle(adminRequest('/tokens', platformToken));
		expect(response.status).toBe(200);
		const rows = (await response.json()) as Array<{
			name: string;
			level: string;
			hash?: unknown;
		}>;
		const row = rows.find((r) => r.name === 'test-admin-app');
		expect(row?.level).toBe('app');
		expect(row?.hash).toBeUndefined();
	});
	it('creates a token and returns the plaintext once', async () => {
		const response = await app.handle(
			adminRequest('/tokens', platformToken, 'POST', { name: 'test-admin-minted', level: 'app' })
		);
		expect(response.status).toBe(200);
		const created = (await response.json()) as { token: string };
		expect(created.token.startsWith('rp_')).toBeTrue();
		expect(tokensDatabase.get('test-admin-minted')).toBeDefined();
		tokensDatabase.remove('test-admin-minted');
	});
	it('409s on duplicate names', async () => {
		const response = await app.handle(
			adminRequest('/tokens', platformToken, 'POST', { name: 'test-admin-app', level: 'app' })
		);
		expect(response.status).toBe(409);
	});
	it('422s on invalid slugs', async () => {
		const response = await app.handle(
			adminRequest('/tokens', platformToken, 'POST', { name: 'Bad Name', level: 'app' })
		);
		expect(response.status).toBe(422);
	});
	it('returns a uniform 422 for an invalid token level', async () => {
		const response = await app.handle(
			adminRequest('/tokens', platformToken, 'POST', { name: 'test-admin-level', level: 'root' })
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});
	it('maps a duplicate-name insert race to 409', async () => {
		tokensDatabase.create('test-admin-race', 'app');
		const originalGet = tokensDatabase.get.bind(tokensDatabase);
		const get = spyOn(tokensDatabase, 'get').mockImplementation((name) =>
			name === 'test-admin-race' ? undefined : originalGet(name)
		);
		try {
			const response = await app.handle(
				adminRequest('/tokens', platformToken, 'POST', {
					name: 'test-admin-race',
					level: 'app'
				})
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				code: 409,
				message: "Token 'test-admin-race' already exists."
			});
		} finally {
			get.mockRestore();
			tokensDatabase.remove('test-admin-race');
		}
	});
	it('revokes tokens, including self', async () => {
		const victim = tokensDatabase.create('test-admin-victim', 'platform');
		const response = await app.handle(adminRequest('/tokens/test-admin-victim', victim, 'DELETE'));
		expect(response.status).toBe(200);
		expect(tokensDatabase.get('test-admin-victim')).toBeUndefined();
	});
	it('404s revoking unknown tokens', async () => {
		const response = await app.handle(
			adminRequest('/tokens/test-admin-nope', platformToken, 'DELETE')
		);
		expect(response.status).toBe(404);
	});
	it('allows deleting the last platform token', async () => {
		tokensDatabase.remove('test-admin-platform');
		const last = tokensDatabase.create('test-admin-last-platform', 'platform');
		try {
			expect(tokensDatabase.list().filter((token) => token.level === 'platform')).toHaveLength(1);
			const response = await app.handle(
				adminRequest('/tokens/test-admin-last-platform', last, 'DELETE')
			);
			expect(response.status).toBe(200);
			expect(tokensDatabase.get('test-admin-last-platform')).toBeUndefined();
		} finally {
			tokensDatabase.remove('test-admin-last-platform');
			platformToken = tokensDatabase.create('test-admin-platform', 'platform');
		}
	});
});

describe('admin bucket endpoints', () => {
	it('lists and reads buckets', async () => {
		const list = await app.handle(adminRequest('/buckets', appToken));
		expect(list.status).toBe(200);
		const buckets = (await list.json()) as Array<{
			name: string;
			priority: number;
			limit_ms: number;
			limit_kb: number;
			members: number;
		}>;
		expect(buckets.find((bucket) => bucket.name === 'wildcard')).toEqual({
			name: 'wildcard',
			priority: 1000,
			limit_ms: 5,
			limit_kb: 10,
			members: 0
		});
		const one = await app.handle(adminRequest('/buckets/wildcard', appToken));
		expect(await one.json()).toEqual({
			name: 'wildcard',
			priority: 1000,
			limit_ms: 5,
			limit_kb: 10,
			members: 0
		});
	});
	it('404s on unknown buckets', async () => {
		expect((await app.handle(adminRequest('/buckets/test-nope', appToken))).status).toBe(404);
	});
	it('upserts a bucket and the change is immediately visible', async () => {
		policyDatabase.removeBucket('test-bkt');
		invalidatePolicyCache();
		try {
			expect(loadPolicy().buckets.find((bucket) => bucket.name === 'test-bkt')).toBeUndefined();

			const put = await app.handle(
				adminRequest('/buckets/test-bkt', appToken, 'PUT', {
					priority: 10,
					limit_ms: 50,
					limit_kb: 50
				})
			);
			expect(put.status).toBe(200);
			expect(loadPolicy().buckets.find((bucket) => bucket.name === 'test-bkt')).toEqual({
				name: 'test-bkt',
				priority: 10,
				limit_ms: 50,
				limit_kb: 50
			});
			const read = await app.handle(adminRequest('/buckets/test-bkt', appToken));
			expect(((await read.json()) as { priority: number }).priority).toBe(10);
		} finally {
			policyDatabase.removeBucket('test-bkt');
			invalidatePolicyCache();
		}
	});
	it('rejects invalid limits via schema', async () => {
		const put = await app.handle(
			adminRequest('/buckets/test-bad', appToken, 'PUT', {
				priority: 10,
				limit_ms: 0,
				limit_kb: 50
			})
		);
		expect(put.status).toBe(422);
		expect(await put.json()).toEqual({ code: 422, message: expect.any(String) });
		expect(policyDatabase.getBucket('test-bad')).toBeUndefined();
	});
	it('409s deleting a bucket referenced by a rule', async () => {
		const account = 'test-admin-bucket-409';
		const clearUsage = () =>
			database
				.delete(schema.usage)
				.where(and(eq(schema.usage.account, account), eq(schema.usage.bucket, 'wildcard')))
				.run();
		clearUsage();
		try {
			await usageDatabase.incrementUsage(account, 321, 654, 'wildcard');
			const usageBefore = usageDatabase.getBucketUsage(account, 'wildcard');
			expect(usageBefore).toEqual({ cpu: 321, net: 654 });

			const response = await app.handle(adminRequest('/buckets/wildcard', appToken, 'DELETE'));
			expect(response.status).toBe(409);
			expect(policyDatabase.getBucket('wildcard')).toBeDefined();
			expect(usageDatabase.getBucketUsage(account, 'wildcard')).toEqual(usageBefore);
		} finally {
			clearUsage();
		}
	});
	it('deletes an unreferenced bucket and purges its usage', async () => {
		policyDatabase.removeBucket('test-gone');
		usageDatabase.purgeBucket('test-gone');
		invalidatePolicyCache();
		try {
			policyDatabase.putBucket('test-gone', 50, 10, 10);
			await usageDatabase.incrementUsage('someuser', 1000, 1000, 'test-gone');
			expect(loadPolicy().buckets.find((bucket) => bucket.name === 'test-gone')).toEqual({
				name: 'test-gone',
				priority: 50,
				limit_ms: 10,
				limit_kb: 10
			});

			const response = await app.handle(adminRequest('/buckets/test-gone', appToken, 'DELETE'));
			expect(response.status).toBe(200);
			expect(policyDatabase.getBucket('test-gone')).toBeUndefined();
			expect(loadPolicy().buckets.find((bucket) => bucket.name === 'test-gone')).toBeUndefined();
			expect(usageDatabase.getBucketUsage('someuser', 'test-gone')).toEqual({ cpu: 0, net: 0 });
		} finally {
			policyDatabase.removeBucket('test-gone');
			usageDatabase.purgeBucket('test-gone');
			invalidatePolicyCache();
		}
	});
});

describe('admin rule endpoints', () => {
	it('returns a uniform 422 for an invalid rule body', async () => {
		const response = await app.handle(
			adminRequest('/rules/test-invalid-body', appToken, 'PUT', {
				bucket: 'wildcard',
				allow: []
			})
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});

	it('lists rules as documents', async () => {
		const response = await app.handle(adminRequest('/rules', appToken));
		expect(response.status).toBe(200);
		const rules = (await response.json()) as Array<{
			name: string;
			bucket: string;
			allow: string[];
			require: string[];
		}>;
		expect(rules.find((rule) => rule.name === 'wildcard')).toEqual({
			name: 'wildcard',
			bucket: 'wildcard',
			allow: ['*::*'],
			require: []
		});
	});
	it('reads rules as documents', async () => {
		const response = await app.handle(adminRequest('/rules/wildcard', appToken));
		expect(response.status).toBe(200);
		const rule = (await response.json()) as {
			bucket: string;
			allow: string[];
			require: string[];
		};
		expect(rule.bucket).toBe('wildcard');
		expect(rule.allow).toEqual(['*::*']);
		expect(rule.require).toEqual([]);
	});
	it('404s on unknown rules', async () => {
		expect((await app.handle(adminRequest('/rules/test-nope', appToken))).status).toBe(404);
	});
	it('upserts a rule and replaces its patterns atomically', async () => {
		policyDatabase.putBucket('test-rule-bkt', 20, 10, 10);
		const put = await app.handle(
			adminRequest('/rules/test-rule', appToken, 'PUT', {
				bucket: 'test-rule-bkt',
				allow: ['eosio.token::transfer'],
				require: ['testgame::play']
			})
		);
		expect(put.status).toBe(200);
		const replace = await app.handle(
			adminRequest('/rules/test-rule', appToken, 'PUT', {
				bucket: 'test-rule-bkt',
				allow: ['*::transfer'],
				require: []
			})
		);
		expect(replace.status).toBe(200);
		const doc = (await (await app.handle(adminRequest('/rules/test-rule', appToken))).json()) as {
			allow: string[];
			require: string[];
		};
		expect(doc.allow).toEqual(['*::transfer']);
		expect(doc.require).toEqual([]);
		policyDatabase.removeRule('test-rule');
		policyDatabase.removeBucket('test-rule-bkt');
	});
	it('422s on unknown buckets without changing an existing rule', async () => {
		policyDatabase.putRule('test-orphan', 'wildcard');
		policyDatabase.addPattern('test-orphan', 'allow', '*::*');
		try {
			const response = await app.handle(
				adminRequest('/rules/test-orphan', appToken, 'PUT', {
					bucket: 'test-nope',
					allow: ['eosio.token::transfer'],
					require: []
				})
			);
			expect(response.status).toBe(422);
			expect(policyDatabase.getRule('test-orphan')).toEqual({
				name: 'test-orphan',
				bucket: 'wildcard'
			});
			expect(policyDatabase.listPatterns('test-orphan')).toEqual([
				{ rule: 'test-orphan', kind: 'allow', pattern: '*::*' }
			]);
		} finally {
			policyDatabase.removeRule('test-orphan');
		}
	});
	it('422s on invalid patterns without changing an existing rule', async () => {
		policyDatabase.putRule('test-badpat', 'wildcard');
		policyDatabase.addPattern('test-badpat', 'require', 'eosio.token::transfer');
		try {
			const response = await app.handle(
				adminRequest('/rules/test-badpat', appToken, 'PUT', {
					bucket: 'wildcard',
					allow: ['eon.*::play'],
					require: []
				})
			);
			expect(response.status).toBe(422);
			expect(policyDatabase.getRule('test-badpat')).toEqual({
				name: 'test-badpat',
				bucket: 'wildcard'
			});
			expect(policyDatabase.listPatterns('test-badpat')).toEqual([
				{
					rule: 'test-badpat',
					kind: 'require',
					pattern: 'eosio.token::transfer'
				}
			]);
		} finally {
			policyDatabase.removeRule('test-badpat');
		}
	});
	it('deletes a rule and cascades its patterns', async () => {
		policyDatabase.putRule('test-del', 'wildcard');
		policyDatabase.addPattern('test-del', 'allow', '*::*');
		const response = await app.handle(adminRequest('/rules/test-del', appToken, 'DELETE'));
		expect(response.status).toBe(200);
		expect(policyDatabase.getRule('test-del')).toBeUndefined();
		expect(policyDatabase.listPatterns('test-del')).toEqual([]);
	});
	it('invalidates a primed policy cache after successful PUT and DELETE', async () => {
		policyDatabase.putBucket('test-cache-bkt', 30, 10, 10);
		policyDatabase.removeRule('test-cache-rule');
		invalidatePolicyCache();
		try {
			expect(loadPolicy().rules.find((rule) => rule.name === 'test-cache-rule')).toBeUndefined();
			const put = await app.handle(
				adminRequest('/rules/test-cache-rule', appToken, 'PUT', {
					bucket: 'test-cache-bkt',
					allow: ['*::*'],
					require: []
				})
			);
			expect(put.status).toBe(200);
			expect(loadPolicy().rules.find((rule) => rule.name === 'test-cache-rule')).toBeDefined();

			const remove = await app.handle(adminRequest('/rules/test-cache-rule', appToken, 'DELETE'));
			expect(remove.status).toBe(200);
			expect(loadPolicy().rules.find((rule) => rule.name === 'test-cache-rule')).toBeUndefined();
		} finally {
			policyDatabase.removeRule('test-cache-rule');
			policyDatabase.removeBucket('test-cache-bkt');
			invalidatePolicyCache();
		}
	});
	it('404s deleting an unknown rule', async () => {
		const response = await app.handle(adminRequest('/rules/test-delete-nope', appToken, 'DELETE'));
		expect(response.status).toBe(404);
	});
});

describe('admin settings endpoints', () => {
	it('requires authentication', async () => {
		expect((await app.handle(adminRequest('/settings'))).status).toBe(401);
	});
	it('lists the full registry', async () => {
		const response = await app.handle(adminRequest('/settings', appToken));
		expect(response.status).toBe(200);
		const rows = (await response.json()) as Array<{
			key: string;
			type: string;
			description: string;
			default: string | null;
			value: string | null;
			set: boolean;
		}>;
		for (const row of rows) {
			expect(Object.keys(row).sort()).toEqual([
				'default',
				'description',
				'key',
				'set',
				'type',
				'value'
			]);
		}
		expect(rows.find((row) => row.key === 'provider.usage.window_hours')).toEqual({
			key: 'provider.usage.window_hours',
			type: 'integer',
			description:
				'Rolling usage window (hours); shrinking forgives usage instantly, growing only re-counts rows not yet cleaned up',
			default: '24',
			value: '24',
			set: false
		});
		expect(rows.find((row) => row.key === 'provider.require_resource_need')).toMatchObject({
			type: 'boolean',
			default: 'true',
			value: 'true',
			set: false
		});
		expect(
			rows.find((row) => row.key === 'provider.paid_transactions.fee_recipient')
		).toMatchObject({
			type: 'string',
			default: null,
			value: null,
			set: false
		});
	});
	it('applies a batch and the change is immediately readable', async () => {
		expect(getInt('provider.min_cpu_us')).toBe(50000);
		try {
			const put = await app.handle(
				adminRequest('/settings', appToken, 'PUT', { 'provider.min_cpu_us': '70000' })
			);
			expect(put.status).toBe(200);
			expect(await put.json()).toEqual({ code: 200, message: 'Settings updated' });
			expect(getInt('provider.min_cpu_us')).toBe(70000);
			const rows = (await (await app.handle(adminRequest('/settings', appToken))).json()) as Array<{
				key: string;
				value: string | null;
			}>;
			const row = rows.find((entry: { key: string }) => entry.key === 'provider.min_cpu_us');
			expect(row?.value).toBe('70000');
		} finally {
			const cleanup = await app.handle(
				adminRequest('/settings', appToken, 'PUT', { 'provider.min_cpu_us': null })
			);
			expect(cleanup.status).toBe(200);
			expect(getInt('provider.min_cpu_us')).toBe(50000);
		}
	});
	it('422s listing all offenders and applies nothing', async () => {
		const response = await app.handle(
			adminRequest('/settings', appToken, 'PUT', {
				'provider.min_cpu_us': '71000',
				'provider.bogus': 'x',
				'provider.usage.window_hours': '-5'
			})
		);
		expect(response.status).toBe(422);
		const body = (await response.json()) as {
			code: number;
			message: string;
			errors: Array<{ key: string; error: string }>;
		};
		expect(body).toEqual({
			code: 422,
			message: 'Invalid settings',
			errors: [
				{ key: 'provider.bogus', error: 'Unknown setting' },
				{ key: 'provider.usage.window_hours', error: 'must be greater than 0' }
			]
		});
		expect(getInt('provider.min_cpu_us')).toBe(50000);
	});
});

describe('admin usage endpoint', () => {
	it('returns a uniform 422 when limit is missing a numeric value', async () => {
		const response = await app.handle(adminRequest('/usage?limit=', appToken));
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});

	it('pages the full set without gaps or repeats', async () => {
		await usageDatabase.resetAllUsage();
		try {
			for (let i = 0; i < 5; i++) {
				await usageDatabase.incrementUsage(`pageuser${i + 1}`, 100, 100, 'wildcard');
			}
			const seen: string[] = [];
			let cursor: string | null = null;
			do {
				const path: string = `/usage?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
				const response = await app.handle(adminRequest(path, appToken));
				expect(response.status).toBe(200);
				const page = (await response.json()) as {
					window_hours: number;
					usage: Array<{ account: string; bucket: string }>;
					next_cursor: string | null;
				};
				expect(page.window_hours).toBeGreaterThan(0);
				for (const row of page.usage) {
					seen.push(`${row.account}:${row.bucket}`);
				}
				cursor = page.next_cursor;
			} while (cursor);
			expect(seen).toEqual([
				'pageuser1:wildcard',
				'pageuser2:wildcard',
				'pageuser3:wildcard',
				'pageuser4:wildcard',
				'pageuser5:wildcard'
			]);
			expect(new Set(seen).size).toBe(5);
		} finally {
			await usageDatabase.resetAllUsage();
		}
	});

	it('aggregates cpu and net per account and bucket', async () => {
		await usageDatabase.resetAllUsage();
		try {
			await usageDatabase.incrementUsage('sumuser', 100, 10, 'wildcard');
			await usageDatabase.incrementUsage('sumuser', 200, 20, 'wildcard');
			const response = await app.handle(adminRequest('/usage', appToken));
			expect(response.status).toBe(200);
			const page = (await response.json()) as {
				window_hours: number;
				usage: unknown[];
				next_cursor: string | null;
			};
			expect(page).toEqual({
				window_hours: getInt('provider.usage.window_hours'),
				usage: [{ account: 'sumuser', bucket: 'wildcard', cpu: 300, net: 30 }],
				next_cursor: null
			});
		} finally {
			await usageDatabase.resetAllUsage();
		}
	});

	it('composes account and bucket filters', async () => {
		await usageDatabase.resetAllUsage();
		try {
			await usageDatabase.incrementUsage('filtera', 1, 2, 'wildcard');
			await usageDatabase.incrementUsage('filtera', 3, 4, 'priority');
			await usageDatabase.incrementUsage('filterb', 5, 6, 'wildcard');
			const response = await app.handle(
				adminRequest('/usage?account=filtera&bucket=wildcard', appToken)
			);
			expect(response.status).toBe(200);
			const page = (await response.json()) as { usage: unknown[] };
			expect(page.usage).toEqual([{ account: 'filtera', bucket: 'wildcard', cpu: 1, net: 2 }]);
		} finally {
			await usageDatabase.resetAllUsage();
		}
	});

	it('returns a uniform 422 for malformed cursors', async () => {
		const response = await app.handle(adminRequest('/usage?cursor=not-base64-json', appToken));
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: 'Invalid cursor' });
	});

	it('returns a uniform 422 for an empty supplied cursor', async () => {
		const response = await app.handle(adminRequest('/usage?cursor=', appToken));
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: 'Invalid cursor' });
	});

	it('returns a uniform 422 for cursors with the wrong shape', async () => {
		const cursor = Buffer.from(JSON.stringify({ account: 'only-account' })).toString('base64url');
		const response = await app.handle(adminRequest(`/usage?cursor=${cursor}`, appToken));
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: 'Invalid cursor' });
	});

	for (const limit of ['0', '1.5', '5000', 'nope']) {
		it(`returns a uniform 422 for invalid limit ${limit}`, async () => {
			const response = await app.handle(adminRequest(`/usage?limit=${limit}`, appToken));
			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
		});
	}
});

describe('admin account endpoints', () => {
	const account = 'test.gm';
	const validBody = {
		account,
		min_ms: 10,
		min_kb: 10,
		inc_ms: 5,
		inc_kb: 5,
		max_fee: '0.1000 A'
	};

	it('allows app tokens to add, list, and remove managed accounts', async () => {
		const unknown = await app.handle(adminRequest(`/accounts/${account}`, appToken, 'DELETE'));
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({
			code: 404,
			message: `Unknown managed account '${account}'`
		});
		try {
			const add = await app.handle(adminRequest('/accounts', appToken, 'POST', validBody));
			expect(add.status).toBe(200);
			expect(await add.json()).toEqual({ code: 200, message: 'Account added for management' });

			const listResponse = await app.handle(adminRequest('/accounts', appToken));
			expect(listResponse.status).toBe(200);
			const list = (await listResponse.json()) as ManagedAccountDTO[];
			expect(list.find((row) => row.account === account)).toEqual({
				account,
				min_ms: 10,
				min_kb: 10,
				inc_ms: 5,
				inc_kb: 5,
				max_fee: '0.1000 A'
			});

			const remove = await app.handle(adminRequest(`/accounts/${account}`, appToken, 'DELETE'));
			expect(remove.status).toBe(200);
			expect(await remove.json()).toEqual({
				code: 200,
				message: 'Account removed from management'
			});
			const after = (await (
				await app.handle(adminRequest('/accounts', appToken))
			).json()) as Array<{ account: string }>;
			expect(after.some((row) => row.account === account)).toBeFalse();
		} finally {
			await app.handle(adminRequest(`/accounts/${account}`, appToken, 'DELETE'));
		}
	});

	it('allows platform tokens to list managed accounts', async () => {
		expect((await app.handle(adminRequest('/accounts', platformToken))).status).toBe(200);
	});

	it('404s deleting an unknown managed account with a uniform body', async () => {
		const response = await app.handle(adminRequest('/accounts/test.nope', appToken, 'DELETE'));
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			code: 404,
			message: "Unknown managed account 'test.nope'"
		});
	});

	it('requires authorization', async () => {
		expect((await app.handle(adminRequest('/accounts'))).status).toBe(401);
	});

	it('returns a uniform 422 for an invalid account body', async () => {
		const response = await app.handle(
			adminRequest('/accounts', appToken, 'POST', {
				account: 'test.gm',
				min_ms: 10
			})
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});

	for (const [field, value] of [
		['account', 'invalid!'],
		['max_fee', 'not-an-asset']
	] as const) {
		it(`returns a uniform 422 for a schema-valid invalid ${field}`, async () => {
			const response = await app.handle(
				adminRequest('/accounts', appToken, 'POST', { ...validBody, [field]: value })
			);
			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
		});
	}
});

describe('production-ordered validation handling', () => {
	let productionApp: ReturnType<typeof makeProductionOrderedApp>;

	beforeAll(() => {
		productionApp = makeProductionOrderedApp();
	});

	it('returns the typed 422 envelope for Admin after the parent handler is installed', async () => {
		const response = await productionApp.handle(
			adminRequest('/accounts', appToken, 'POST', { account: 'test.gm' })
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});

	it('returns the typed 422 envelope for manager aliases after the parent handler is installed', async () => {
		const response = await productionApp.handle(
			new Request('http://localhost/v2/resource/manager/add', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${appToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ account: 'test.gm' })
			})
		);
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
	});

	it('preserves the legacy global validation response outside Admin and manager routes', async () => {
		const response = await productionApp.handle(
			new Request('http://localhost/legacy-validation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			})
		);
		expect(response.status).toBe(422);
		const body = (await response.json()) as { code?: number; message?: string; all?: unknown[] };
		expect(body.code).toBeUndefined();
		expect(body.message).toEqual(expect.any(String));
		expect(body.all).toEqual(expect.any(Array));
	});
});
