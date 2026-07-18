import { Elysia } from 'elysia';

import { admin } from '$api/v2/admin';
import { getApp, startApp } from '$lib/http';
import { generalLog } from '$lib/logger';
import { ENABLE_ADMIN_API } from 'src/config';

export function mountAdminRoutes<const App extends Elysia>(app: App) {
	return app.group('/v2', (root) => root.group('/admin', (g) => g.use(admin)));
}

export function adminServer() {
	if (!ENABLE_ADMIN_API) {
		generalLog.info(
			'Admin API is disabled. Set ENABLE_ADMIN_API=true if you wish to run this service.'
		);
		return;
	}
	const app = mountAdminRoutes(getApp());
	startApp();
	generalLog.info('Admin API routes loaded');
	return app;
}
