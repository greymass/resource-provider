import { Asset } from '@wharfkit/antelope';
import { Argument, Command } from 'commander';

import { ManagedAccount, managedAccounts } from '$lib/db/models/manager/account';
import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import {
	ANTELOPE_SYSTEM_TOKEN,
	MANAGED_ACCOUNT_RAM_INCREMENT_KB,
	MANAGED_ACCOUNT_RAM_MINIMUM_KB
} from 'src/config';

function parseLegacyMaxFee(maxFee: unknown): string {
	const numeric = Number(maxFee ?? 0);
	const amount = Number.isFinite(numeric) ? numeric : 0;
	return String(Asset.fromFloat(amount, ANTELOPE_SYSTEM_TOKEN));
}

export function makeManagerAddCommand() {
	const command = new Command('add');
	command
		.addArgument(new Argument('<account>', 'The account name to manage'))
		.addArgument(
			new Argument(
				'<min_ms>',
				'Minimum CPU available for account in milliseconds (e.g. 1 for 1ms/1000µs)'
			)
		)
		.addArgument(
			new Argument(
				'<min_kb>',
				'Minimum NET available for account in kilobytes (e.g. 1 for 1kB/1000b)'
			)
		)
		.addArgument(
			new Argument('<inc_ms>', 'CPU increment per powerup in milliseconds (e.g. 1 for 1ms/1000µs)')
		)
		.addArgument(
			new Argument('<inc_kb>', 'NET increment per powerup in kilobytes (e.g. 1 for 1kB/1000b)')
		)
		.addArgument(
			new Argument(
				'[legacy_max_fee]',
				'Deprecated compatibility field. Managed account powerups are uncapped.'
			).default(0)
		)
		.addArgument(
			new Argument(
				'[min_ram_kb]',
				`Minimum RAM available for account in kilobytes before buying RAM (default: ${MANAGED_ACCOUNT_RAM_MINIMUM_KB})`
			).default(MANAGED_ACCOUNT_RAM_MINIMUM_KB)
		)
		.addArgument(
			new Argument(
				'[inc_ram_kb]',
				`RAM increment to buy in kilobytes when the RAM minimum is not met (default: ${MANAGED_ACCOUNT_RAM_INCREMENT_KB})`
			).default(MANAGED_ACCOUNT_RAM_INCREMENT_KB)
		)
		.description('Automatically manage CPU/NET/RAM resources for an account')
		.action((account, min_ms, min_kb, inc_ms, inc_kb, max_fee, min_ram_kb, inc_ram_kb) => {
			const data = ManagedAccount.from({
				account,
				min_ms,
				min_kb,
				min_ram_kb,
				inc_ms,
				inc_kb,
				inc_ram_kb,
				max_fee: parseLegacyMaxFee(max_fee)
			});
			managerLog.info('Adding account to manage', objectify(data));
			managedAccounts.addManagedAccount(data);
		});
	return command;
}
