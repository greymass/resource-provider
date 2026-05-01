import { Cron, type CronOptions } from 'croner';

import { getManagerContext } from './context';
import { manageAccountResources } from './manage/account';

import { managed } from '$api/v2/manager';
import { getApp, startApp } from '$lib/http';
import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import { getManagerSession } from '$lib/wharf/session';
import { ENABLE_RESOURCE_MANAGER, MANAGER_CRONJOB } from 'src/config';

const cron = MANAGER_CRONJOB;
const cronOptions: CronOptions = { catch: (e) => managerLog.error(e), protect: true };

export const managerJob = async function () {
	try {
		const manager = await getManagerSession();
		const managerContext = await getManagerContext();
		for (const account of managerContext.managedAccounts) {
			managerLog.debug('Running resource management', objectify({ account }));
			await manageAccountResources(manager, account, managerContext);
		}
	} catch (error) {
		managerLog.error('managerJob failed', { error: String(error) });
	}
};

export async function manager() {
	if (!ENABLE_RESOURCE_MANAGER) {
		managerLog.info(
			'Resource Manager Service is disabled. Set ENABLE_RESOURCE_MANAGER=true if you wish to run this service.'
		);
		return;
	}

	const app = getApp();
	app.group('/v2', (root) =>
		root.group('/resource', (resource) => resource.group('/manager', (g) => g.use(managed)))
	);

	startApp();
	managerLog.info('Resource Manager API routes loaded');

	managerLog.info('Resource Manager Service starting', { cron, cronOptions });
	managerJob();
	new Cron(cron, cronOptions, managerJob);
}
