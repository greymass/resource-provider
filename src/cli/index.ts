import { Argument, Command } from 'commander';

import { version } from '../../package.json';
import { adminServer } from '../admin';
import { generalLog } from '../lib/logger';
import { manager } from '../manager';
import { server } from '../provider';
import { validateProviderAccount } from '../provider/validate';
import { selfManagement } from '../self-management';

import { makeConfigCommand } from './config';
import { makeManagerAddCommand } from './manager/add';
import { makeManagerListCommand } from './manager/list';
import { makeManagerRemoveCommand } from './manager/remove';
import { makeManagerRunCommand } from './manager/run';
import { makeManagerSetupCommand } from './manager/setup';
import { makeManagerUnauthorizeCommand } from './manager/unauthorize';
import { makeProviderSetupCommand } from './provider/setup';
import { makeRulesCommand } from './rules';
import { makeTokenCommand } from './token';

import { policyDatabase } from '$lib/db/models/provider/policy';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { createEnvironmentalFile } from '$lib/env';
import { bootstrapPolicy } from '$lib/rules/bootstrap';
import { getInt, missingRequiredSettings } from '$lib/settings';
import { warnRetiredEnvVars } from '$lib/settings/retired';
import { ENABLE_FREE_TRANSACTIONS, ENABLE_RESOURCE_PROVIDER } from 'src/config';

const services = ['all', 'api', 'manager'];

export function prompt() {
	const program = new Command();
	program
		.version(version)
		.name('resource-provider')
		.description('Antelope Resource Provider Service');

	program.commandsGroup('Configuration');
	program.addCommand(makeConfigCommand());
	program.addCommand(makeRulesCommand());
	program.addCommand(makeTokenCommand());
	const env = program.command('env').description('Manage the .env configuration file');
	env
		.command('init')
		.description('Create a new blank configuration file')
		.action(async () => {
			await createEnvironmentalFile();
			generalLog.info('Created a new blank configuration file (.env)');
		});

	program.commandsGroup('Run Service');
	program
		.command('start')
		.addArgument(
			new Argument('[service]', 'The service name to start').default('all').choices(services)
		)
		.description('Run one or more resource provider services (e.g. all, api, manager)')
		.action(async (service) => {
			warnRetiredEnvVars();
			if ((service === 'all' || service === 'api') && ENABLE_RESOURCE_PROVIDER) {
				const missing = missingRequiredSettings();
				if (missing.length > 0) {
					for (const def of missing) {
						generalLog.error(
							`Missing required setting '${def.key}' (${def.description}). Set it with: rpcli config set ${def.key} <value>`
						);
					}
					return;
				}
				bootstrapPolicy();
				if (ENABLE_FREE_TRANSACTIONS && policyDatabase.listBuckets().length === 0) {
					generalLog.error(
						'Free transactions are enabled but no buckets exist. Create one with: rpcli rules bucket add <name> <priority> <limit_ms> <limit_kb>'
					);
					return;
				}
				const valid = await validateProviderAccount();
				if (!valid) {
					return;
				}
				server();
			}
			if (service === 'all' || service === 'manager') {
				manager();
			}
			adminServer();
			selfManagement();
		});

	program.commandsGroup('Resource Manager');
	const manage = program
		.command('manager [add|list|remove|run|setup|unauthorize]')
		.description('Define a list of accounts and automatically manage their network resources.');
	manage.addCommand(makeManagerAddCommand());
	manage.addCommand(makeManagerListCommand());
	manage.addCommand(makeManagerRemoveCommand());
	manage.addCommand(makeManagerRunCommand());
	manage.addCommand(makeManagerSetupCommand());
	manage.addCommand(makeManagerUnauthorizeCommand());

	program.commandsGroup('Resource Provider');
	const provide = program
		.command('provider [setup]')
		.description('Configure the resource provider cosigning account.');
	provide.addCommand(makeProviderSetupCommand());

	program.commandsGroup('User Management');
	program
		.command('reset')
		.description('Reset all usage tracking records')
		.action(async () => {
			generalLog.info('Resetting all usage records');
			await usageDatabase.resetAllUsage();
		});
	program
		.command('usage')
		.description('Get the total usage for a specific account name')
		.argument('<string>', 'account name to query')
		.action(async (name) => {
			const byBucket = usageDatabase.getUsageByBucket(name);
			generalLog.info(
				`Usage for ${name} (last ${getInt('provider.usage.window_hours')}h):`,
				byBucket
			);
		});
	program.commandsGroup('Database Management');
	program
		.command('vacuum')
		.description('Force SQLITE3 database vacuum')
		.action(() => {
			generalLog.info('Vacuuming database');
			usageDatabase.vacuum();
		});
	program.parse(process.argv);
}
