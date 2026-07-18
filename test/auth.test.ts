import { bearer } from '@elysiajs/bearer';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { guardAuthorization, guardPlatform } from '../src/api/v2/auth';
import { managed } from '../src/api/v2/manager';

import { tokensDatabase } from '$lib/db/models/provider/tokens';
import { withGlobalErrorHandling } from '$lib/http';

let appToken: string;
let platformToken: string;

const app = new Elysia()
	.use(bearer())
	.guard(guardAuthorization, (g) => g.get('/authed', () => ({ code: 200 })))
	.guard(guardPlatform, (g) => g.get('/platform', () => ({ code: 200 })));

const managerApp = withGlobalErrorHandling(new Elysia()).group('/v2', (root) =>
	root.group('/resource', (resource) => resource.group('/manager', (g) => g.use(managed)))
);

function request(path: string, token?: string, method = 'GET', body?: unknown) {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(body === undefined ? {} : { 'Content-Type': 'application/json' })
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
}

describe('auth guards', () => {
	beforeAll(() => {
		appToken = tokensDatabase.create('test-auth-app', 'app');
		platformToken = tokensDatabase.create('test-auth-platform', 'platform');
	});
	afterAll(() => {
		tokensDatabase.remove('test-auth-app');
		tokensDatabase.remove('test-auth-platform');
	});
	it('rejects missing tokens with 401', async () => {
		expect((await app.handle(request('/authed'))).status).toBe(401);
	});
	it('rejects garbage tokens with 401', async () => {
		expect((await app.handle(request('/authed', 'rp_garbage'))).status).toBe(401);
	});
	it('accepts app tokens on authed routes', async () => {
		expect((await app.handle(request('/authed', appToken))).status).toBe(200);
	});
	it('rejects app tokens on platform routes with 403', async () => {
		expect((await app.handle(request('/platform', appToken))).status).toBe(403);
	});
	it('accepts platform tokens everywhere', async () => {
		expect((await app.handle(request('/authed', platformToken))).status).toBe(200);
		expect((await app.handle(request('/platform', platformToken))).status).toBe(200);
	});
	it('rejects revoked tokens immediately', async () => {
		const token = tokensDatabase.create('test-auth-revoked', 'app');
		expect((await app.handle(request('/authed', token))).status).toBe(200);
		tokensDatabase.remove('test-auth-revoked');
		expect((await app.handle(request('/authed', token))).status).toBe(401);
	});
	it('requires a token on manager list', async () => {
		expect((await managerApp.handle(request('/v2/resource/manager/list'))).status).toBe(401);
		expect((await managerApp.handle(request('/v2/resource/manager/list', appToken))).status).toBe(
			200
		);
	});
	it('requires a token on manager add and remove', async () => {
		const body = {
			account: 'test.gm',
			min_ms: 10,
			min_kb: 10,
			inc_ms: 5,
			inc_kb: 5,
			max_fee: '0.1000 A'
		};
		expect(
			(await managerApp.handle(request('/v2/resource/manager/add', undefined, 'POST', body))).status
		).toBe(401);
		expect(
			(
				await managerApp.handle(
					request('/v2/resource/manager/remove', undefined, 'POST', { account: body.account })
				)
			).status
		).toBe(401);
	});
	it('returns canonical 404 semantics for an unknown manager remove', async () => {
		const response = await managerApp.handle(
			request('/v2/resource/manager/remove', appToken, 'POST', { account: 'test.nope' })
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			code: 404,
			message: "Unknown managed account 'test.nope'"
		});
	});

	for (const [field, value] of [
		['account', 'invalid!'],
		['max_fee', 'not-an-asset']
	] as const) {
		it(`returns a uniform 422 for a schema-valid invalid manager ${field}`, async () => {
			const body = {
				account: 'test.gm',
				min_ms: 10,
				min_kb: 10,
				inc_ms: 5,
				inc_kb: 5,
				max_fee: '0.1000 A',
				[field]: value
			};
			const response = await managerApp.handle(
				request('/v2/resource/manager/add', appToken, 'POST', body)
			);
			expect(response.status).toBe(422);
			expect(await response.json()).toEqual({ code: 422, message: expect.any(String) });
		});
	}
});
