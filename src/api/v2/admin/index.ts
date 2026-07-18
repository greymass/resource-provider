import { bearer } from '@elysiajs/bearer';
import { Elysia } from 'elysia';

import { guardAuthorization, guardPlatform } from '../auth';

import { adminAccess } from './access';
import { adminAccounts } from './accounts';
import { adminBuckets } from './buckets';
import { adminRules } from './rules';
import { adminSettings } from './settings';
import { adminTokens } from './tokens';
import { adminUsage } from './usage';

import { typedValidationResponse } from '$lib/http';

export const admin = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === 'VALIDATION') return typedValidationResponse(error, set);
	})
	.onAfterHandle(({ set }) => {
		set.headers['cache-control'] = 'no-store';
	})
	.use(bearer())
	.guard(guardAuthorization, (guarded) =>
		guarded
			.use(adminBuckets)
			.use(adminAccess)
			.use(adminRules)
			.use(adminSettings)
			.use(adminAccounts)
			.use(adminUsage)
			.guard(guardPlatform, (platform) => platform.use(adminTokens))
	);
