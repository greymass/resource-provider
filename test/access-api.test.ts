import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { admin } from '../src/api/v2/admin';
import { usage } from '../src/api/v2/provider/usage';

import { database } from '$lib/db';
import { accessDatabase } from '$lib/db/models/provider/access';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { tokensDatabase } from '$lib/db/models/provider/tokens';
import * as schema from '$lib/db/schema';

let token: string;
const app = new Elysia().group('/v2', (root) => root.group('/admin', (g) => g.use(admin)));

function request(path: string, init: RequestInit = {}) {
	return app.handle(
		new Request(`http://localhost/v2/admin${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				...(init.headers ?? {})
			}
		})
	);
}

function post(path: string, body: unknown) {
	return request(path, { method: 'POST', body: JSON.stringify(body) });
}

beforeAll(() => {
	database.delete(schema.tokens).run();
	token = tokensDatabase.create('access-api-test', 'app');
});

beforeEach(() => {
	database.delete(schema.providerBucketAccount).run();
	policyDatabase.putBucket('vip', 1, 10, 10);
});

describe('admin bucket accounts API', () => {
	it('bulk adds members and reports counts', async () => {
		const res = await post('/buckets/vip/accounts', { accounts: ['alice', 'bob'] });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ added: 2, ignored: 0, members: 2 });
		const again = await post('/buckets/vip/accounts', { accounts: ['alice'] });
		expect(await again.json()).toEqual({ added: 0, ignored: 1, members: 2 });
	});

	it('rejects invalid account names listing all offenders, applying nothing', async () => {
		const res = await post('/buckets/vip/accounts', { accounts: ['alice', 'BAD', 'also_bad'] });
		expect(res.status).toBe(422);
		const body = (await res.json()) as { message: string };
		expect(body.message).toContain('BAD');
		expect(body.message).toContain('also_bad');
		expect(accessDatabase.count('vip')).toBe(0);
	});

	it('404s on an unknown bucket', async () => {
		const res = await post('/buckets/nope/accounts', { accounts: ['alice'] });
		expect(res.status).toBe(404);
	});

	it('bulk removes and announces the empty transition', async () => {
		await post('/buckets/vip/accounts', { accounts: ['alice', 'bob'] });
		const partial = await post('/buckets/vip/accounts/remove', { accounts: ['alice'] });
		expect(await partial.json()).toMatchObject({ removed: 1, empty: false, members: 1 });
		const final = await post('/buckets/vip/accounts/remove', { accounts: ['bob', 'ghost'] });
		const body = (await final.json()) as { message: string };
		expect(body).toMatchObject({ removed: 1, empty: true, members: 0 });
		expect(body.message).toContain('OPEN');
	});

	it('checks membership', async () => {
		await post('/buckets/vip/accounts', { accounts: ['alice'] });
		const hit = await request('/buckets/vip/accounts/alice');
		expect(hit.status).toBe(200);
		expect(await hit.json()).toEqual({ account: 'alice' });
		expect((await request('/buckets/vip/accounts/bob')).status).toBe(404);
	});

	it('paginates the member list with a stable cursor', async () => {
		await post('/buckets/vip/accounts', { accounts: ['aaa', 'bbb', 'ccc'] });
		const one = await request('/buckets/vip/accounts?limit=2');
		const pageOne = (await one.json()) as {
			accounts: Array<{ account: string }>;
			next_cursor: string | null;
		};
		expect(pageOne.accounts.map((r: { account: string }) => r.account)).toEqual(['aaa', 'bbb']);
		expect(pageOne.next_cursor).not.toBeNull();
		const two = await request(`/buckets/vip/accounts?limit=2&cursor=${pageOne.next_cursor}`);
		const pageTwo = (await two.json()) as {
			accounts: Array<{ account: string }>;
			next_cursor: string | null;
		};
		expect(pageTwo.accounts.map((r: { account: string }) => r.account)).toEqual(['ccc']);
		expect(pageTwo.next_cursor).toBeNull();
	});

	it('reverse-looks-up memberships for an account', async () => {
		policyDatabase.putBucket('std', 10, 10, 10);
		await post('/buckets/vip/accounts', { accounts: ['alice'] });
		await post('/buckets/std/accounts', { accounts: ['alice'] });
		const res = await request('/access/alice');
		const body = (await res.json()) as Array<{ bucket: string }>;
		expect(body.map((r: { bucket: string }) => r.bucket)).toEqual(['std', 'vip']);
	});

	it('caps bulk payloads at 5000 accounts', async () => {
		const accounts = Array.from({ length: 5001 }, (_, i) => `x${i}`);
		expect((await post('/buckets/vip/accounts', { accounts })).status).toBe(422);
	});

	it('requires auth and sends no-store', async () => {
		const anon = await app.handle(new Request('http://localhost/v2/admin/buckets/vip/accounts'));
		expect(anon.status).toBe(401);
		const authed = await request('/buckets/vip/accounts');
		expect(authed.headers.get('cache-control')).toBe('no-store');
	});
});

describe('bucket resources with member counts', () => {
	it('reports members on bucket get and list', async () => {
		await post('/buckets/vip/accounts', { accounts: ['alice', 'bob'] });
		const single = (await (await request('/buckets/vip')).json()) as { members: number };
		expect(single.members).toBe(2);
		const all = (await (await request('/buckets')).json()) as Array<{
			name: string;
			members: number;
		}>;
		expect(all.find((b: { name: string }) => b.name === 'vip')?.members).toBe(2);
	});

	it('purges access rows when a bucket is deleted', async () => {
		await post('/buckets/vip/accounts', { accounts: ['alice'] });
		const res = await request('/buckets/vip', { method: 'DELETE' });
		expect(res.status).toBe(200);
		expect(accessDatabase.count('vip')).toBe(0);
	});
});

describe('public usage eligibility', () => {
	it('reports restricted and eligible per bucket', async () => {
		await post('/buckets/vip/accounts', { accounts: ['alice'] });
		const set = { headers: {} as Record<string, string> };
		const forAlice = await usage({ params: { account: 'alice' }, set });
		const vipForAlice = forAlice.buckets.find((b) => b.bucket === 'vip');
		expect(vipForAlice).toMatchObject({ restricted: true, eligible: true });
		const forBob = await usage({ params: { account: 'bob' }, set });
		const vipForBob = forBob.buckets.find((b) => b.bucket === 'vip');
		expect(vipForBob).toMatchObject({ restricted: true, eligible: false });
		expect(set.headers['cache-control']).toBe('no-store');
	});

	it('reports open buckets as eligible for everyone', async () => {
		const set = { headers: {} as Record<string, string> };
		const result = await usage({ params: { account: 'anyone' }, set });
		const vip = result.buckets.find((b) => b.bucket === 'vip');
		expect(vip).toMatchObject({ restricted: false, eligible: true });
	});
});
