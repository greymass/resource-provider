import { Argument, Command } from 'commander';

import { tokensDatabase } from '$lib/db/models/provider/tokens';
import { generalLog } from '$lib/logger';

type SecretOutput = (token: string) => void;

function writeTokenToStdout(token: string) {
	process.stdout.write(`${token}\n`);
}

export function makeTokenCommand(secretOutput: SecretOutput = writeTokenToStdout) {
	const command = new Command('token');
	command.description('Manage admin API bearer tokens');

	command
		.command('create')
		.addArgument(new Argument('<name>', 'Token name (lowercase slug, e.g. unicove-admin)'))
		.option('--level <level>', 'Token level: platform or app', 'app')
		.description('Create a token and print it once')
		.action((name, options) => {
			if (options.level !== 'platform' && options.level !== 'app') {
				generalLog.error(`Invalid level '${options.level}'. Use 'platform' or 'app'.`);
				return;
			}
			try {
				const token = tokensDatabase.create(name, options.level);
				generalLog.info(
					`Token created for ${name} (${options.level}). Store it now, it will not be shown again:`
				);
				secretOutput(token);
			} catch (error) {
				generalLog.error(error instanceof Error ? error.message : String(error));
			}
		});

	command
		.command('list')
		.description('List tokens (names and levels, never secrets)')
		.action(() => {
			for (const row of tokensDatabase.list()) {
				const used = row.last_used_at ? new Date(row.last_used_at * 1000).toISOString() : 'never';
				generalLog.info(`${row.name}: level=${row.level} last_used=${used}`);
			}
		});

	command
		.command('remove')
		.addArgument(new Argument('<name>', 'Token name'))
		.description('Revoke a token immediately')
		.action((name) => {
			if (!tokensDatabase.get(name)) {
				generalLog.error(`Unknown token '${name}'. Run 'rpcli token list'.`);
				return;
			}
			tokensDatabase.remove(name);
			generalLog.info(`Revoked token ${name}`);
		});

	return command;
}
