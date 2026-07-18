import { Elysia, t } from 'elysia';

import {
	adminConflict,
	adminNameParams,
	adminNotFound,
	adminPlatformResponses,
	adminSuccess,
	adminTokenCreated,
	adminTokenCreateBody,
	adminTokenInfo,
	adminUnprocessable
} from './types';

import {
	TOKEN_NAME_REGEX,
	TokenNameConflictError,
	tokensDatabase
} from '$lib/db/models/provider/tokens';

const tags = ['Admin'];

export const adminTokens = new Elysia({ prefix: '/tokens' })
	.get('/', () => tokensDatabase.list(), {
		response: { 200: t.Array(adminTokenInfo), ...adminPlatformResponses },
		detail: { summary: 'List Tokens', tags }
	})
	.post(
		'/',
		({ body, set }) => {
			if (!TOKEN_NAME_REGEX.test(body.name)) {
				set.status = 422;
				return { code: 422, message: `Invalid token name '${body.name}'. Expected a slug.` };
			}
			try {
				const token = tokensDatabase.create(body.name, body.level);
				return { name: body.name, level: body.level, token };
			} catch (error) {
				if (error instanceof TokenNameConflictError) {
					set.status = 409;
					return { code: 409 as const, message: `Token '${body.name}' already exists.` };
				}
				throw error;
			}
		},
		{
			body: adminTokenCreateBody,
			response: {
				200: adminTokenCreated,
				409: adminConflict,
				422: adminUnprocessable,
				...adminPlatformResponses
			},
			detail: { summary: 'Create Token', tags }
		}
	)
	.delete(
		'/:name',
		({ params, set }) => {
			if (!tokensDatabase.get(params.name)) {
				set.status = 404;
				return { code: 404, message: `Unknown token '${params.name}'` };
			}
			tokensDatabase.remove(params.name);
			return { code: 200, message: `Revoked token ${params.name}` };
		},
		{
			params: adminNameParams,
			response: {
				200: adminSuccess,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminPlatformResponses
			},
			detail: { summary: 'Revoke Token', tags }
		}
	);
