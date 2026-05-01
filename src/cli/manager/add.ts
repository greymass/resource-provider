import { Asset } from '@wharfkit/antelope';
import { Argument, Command } from 'commander';

import { ManagedAccount, managedAccounts } from '$lib/db/models/manager/account';
import { managerLog } from '$lib/logger';
import { objectify } from '$lib/utils';
import { ANTELOPE_SYSTEM_TOKEN } from 'src/config';

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
				'<max_fee>',
				`Maximum fee the provider can charge for a single powerup (e.g. 1 for ${Asset.fromFloat(1, ANTELOPE_SYSTEM_TOKEN || '4,TOKEN')})`
			)
		)
		.addArgument(
			new Argument(
				'[min_ram_kb]',
				'Minimum RAM available for account in kilobytes before buying RAM (default: 0, disabled)'
			).default(0)
		)
		.addArgument(
			new Argument(
				'[inc_ram_kb]',
				'RAM increment to buy in kilobytes when the RAM minimum is not met (default: 0, disabled)'
			).default(0)
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
				max_fee: String(Asset.fromFloat(Number(max_fee), ANTELOPE_SYSTEM_TOKEN))
			});
			managerLog.info('Adding account to manage', objectify(data));
			managedAccounts.addManagedAccount(data);
		});
	return command;
}
