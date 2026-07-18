import type { Context } from 'elysia';

import { tokensDatabase } from '$lib/db/models/provider/tokens';

interface AuthContext {
	bearer: string | undefined;
	set: Context['set'];
}

export function requireAuth({ bearer, set }: AuthContext) {
	if (!bearer || !tokensDatabase.verify(bearer)) {
		set.status = 401;
		return { code: 401, message: 'Unauthorized' };
	}
}

export function requirePlatform({ bearer, set }: AuthContext) {
	const auth = bearer ? tokensDatabase.verify(bearer) : undefined;
	if (!auth) {
		set.status = 401;
		return { code: 401, message: 'Unauthorized' };
	}
	if (auth.level !== 'platform') {
		set.status = 403;
		return { code: 403, message: 'Forbidden: platform token required' };
	}
}

export const guardAuthorization = { beforeHandle: requireAuth };
export const guardPlatform = { beforeHandle: requirePlatform };
