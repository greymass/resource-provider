import { Cron, type CronOptions } from 'croner';

import { v1 } from '$api/v1';
import { lightaccount } from '$api/v2/lightaccount';
import { provider } from '$api/v2/provider';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { getApp, startApp } from '$lib/http';
import { providerLog } from '$lib/logger';
import {
	ENABLE_LIGHTACCOUNT_PROVIDER,
	ENABLE_RESOURCE_PROVIDER,
	PROVIDER_USAGE_CLEANUP_CRON
} from 'src/config';

const cronOptions: CronOptions = {
	catch: (e) => providerLog.error('Usage cleanup cron failed', { error: String(e) }),
	protect: true
};

async function cleanupUsage() {
	const expired = await usageDatabase.cleanupExpired();
	providerLog.info('Cleaned up expired usage records', { expired });
}

export function server() {
	if (!ENABLE_RESOURCE_PROVIDER) {
		providerLog.info(
			'Resource Provider API Service is disabled. Set ENABLE_RESOURCE_PROVIDER=true if you wish to run this service.'
		);
		return;
	}

	new Cron(PROVIDER_USAGE_CLEANUP_CRON, cronOptions, cleanupUsage);
	providerLog.info('Usage cleanup cron scheduled', { cron: PROVIDER_USAGE_CLEANUP_CRON });

	const app = getApp();
	app.use(v1);
	app.group('/v2', (root) =>
		root.group('/resource', (resource) => {
			resource.group('/provider', (g) => g.use(provider));
			if (ENABLE_LIGHTACCOUNT_PROVIDER) {
				resource.group('/lightaccount', (g) => g.use(lightaccount));
			}
			return resource;
		})
	);

	startApp();
	providerLog.info('Resource Provider API routes loaded');
	return app;
}
