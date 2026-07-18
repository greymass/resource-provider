import { Argument, Command } from 'commander';

import { configDatabase } from '$lib/db/models/config';
import { generalLog } from '$lib/logger';
import { setSetting, unsetSetting } from '$lib/settings';
import { getDefinition, registry } from '$lib/settings/registry';
import type { SettingDefinition } from '$lib/settings/registry';

export function describeSetting(def: SettingDefinition): string {
	const row = configDatabase.get(def.key);
	let value: string;
	if (row) {
		value = row.value;
	} else if (def.default !== undefined) {
		value = `${def.default} (default)`;
	} else if (def.requiredWhen?.()) {
		value = '<unset — required!>';
	} else {
		value = '<unset>';
	}
	return `${def.key} = ${value} [${def.type}] ${def.description}`;
}

export function makeConfigCommand() {
	const command = new Command('config');
	command.description('Manage provider settings stored in the database');

	command
		.command('list')
		.description('List all settings with current values')
		.action(() => {
			for (const def of registry) {
				generalLog.info(describeSetting(def));
			}
		});

	command
		.command('get')
		.addArgument(new Argument('<key>', 'The setting key to read'))
		.description('Show a single setting')
		.action((key) => {
			const def = getDefinition(key);
			if (!def) {
				generalLog.error(`Unknown setting '${key}'. Run 'rpcli config list' for valid keys.`);
				return;
			}
			generalLog.info(describeSetting(def));
		});

	command
		.command('set')
		.addArgument(new Argument('<key>', 'The setting key to write'))
		.addArgument(new Argument('<value>', 'The value to store'))
		.description('Set a setting (validated, takes effect within the cache TTL)')
		.action((key, value) => {
			try {
				const result = setSetting(key, value);
				generalLog.info(`Set ${key}: ${result.previous ?? '<unset>'} → ${result.value}`);
			} catch (error) {
				generalLog.error(String(error));
			}
		});

	command
		.command('unset')
		.addArgument(new Argument('<key>', 'The setting key to clear'))
		.description('Remove a setting, reverting to its default')
		.action((key) => {
			try {
				unsetSetting(key);
				const def = getDefinition(key);
				generalLog.info(
					`Unset ${key}${def?.default !== undefined ? `, reverting to default ${def.default}` : ''}`
				);
			} catch (error) {
				generalLog.error(String(error));
			}
		});

	return command;
}
