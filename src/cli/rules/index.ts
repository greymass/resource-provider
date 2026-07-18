import { Argument, Command } from 'commander';

import { accessDatabase, isValidAccountName } from '$lib/db/models/provider/access';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { generalLog } from '$lib/logger';
import { validatePattern } from '$lib/rules';

export function bucketInUse(name: string): string[] {
	return policyDatabase.rulesForBucket(name).map((r) => r.name);
}

function requireBucket(name: string): boolean {
	if (!policyDatabase.getBucket(name)) {
		generalLog.error(`Unknown bucket '${name}'. Run 'rpcli rules bucket list'.`);
		return false;
	}
	return true;
}

function requireRule(name: string): boolean {
	if (!policyDatabase.getRule(name)) {
		generalLog.error(`Unknown rule '${name}'. Run 'rpcli rules list'.`);
		return false;
	}
	return true;
}

async function collectAccounts(args: string[], file?: string): Promise<string[] | undefined> {
	const accounts = [...args];
	if (file) {
		const text = await Bun.file(file).text();
		accounts.push(
			...text
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0)
		);
	}
	if (accounts.length === 0) {
		generalLog.error('No accounts given. Pass account names or --file <path>.');
		return undefined;
	}
	const invalid = accounts.filter((account) => !isValidAccountName(account));
	if (invalid.length > 0) {
		generalLog.error(`Invalid account names: ${invalid.join(', ')}`);
		return undefined;
	}
	return accounts;
}

function makeAccessCommand() {
	const access = new Command('access');
	access.description('Manage bucket access lists (list existence = enforcement)');

	access
		.command('add')
		.addArgument(new Argument('<bucket>', 'Bucket name'))
		.addArgument(new Argument('[accounts...]', 'Account names'))
		.option('--file <path>', 'File with one account per line')
		.description('Add accounts to a bucket access list')
		.action(async (bucketName, accounts, options) => {
			const all = await collectAccounts(accounts, options.file);
			if (!all) return;
			const result = accessDatabase.add(bucketName, all);
			generalLog.info(
				`Bucket ${bucketName}: added=${result.added} ignored=${result.ignored} members=${accessDatabase.count(bucketName)}`
			);
		});

	access
		.command('remove')
		.addArgument(new Argument('<bucket>', 'Bucket name'))
		.addArgument(new Argument('[accounts...]', 'Account names'))
		.option('--file <path>', 'File with one account per line')
		.description('Remove accounts from a bucket access list')
		.action(async (bucketName, accounts, options) => {
			const all = await collectAccounts(accounts, options.file);
			if (!all) return;
			const result = accessDatabase.remove(bucketName, all);
			generalLog.info(
				`Bucket ${bucketName}: removed=${result.removed} members=${accessDatabase.count(bucketName)}`
			);
			if (result.empty) {
				generalLog.info(`Access list empty — bucket ${bucketName} is now OPEN to all accounts`);
			}
		});

	access
		.command('list')
		.addArgument(new Argument('<bucket>', 'Bucket name'))
		.option('--limit <n>', 'Rows per page', '100')
		.option('--cursor <account>', 'Resume after this account')
		.description('List accounts on a bucket access list')
		.action((bucketName, options) => {
			const limit = Number(options.limit);
			if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
				generalLog.error('limit must be an integer between 1 and 1000');
				return;
			}
			const result = accessDatabase.list(bucketName, limit, options.cursor);
			for (const row of result.accounts) {
				generalLog.info(row.account);
			}
			if (result.next) {
				generalLog.info(`More rows — continue with --cursor ${result.next}`);
			}
		});

	access
		.command('check')
		.addArgument(new Argument('<bucket>', 'Bucket name'))
		.addArgument(new Argument('<account>', 'Account name'))
		.description('Check whether an account is on a bucket access list')
		.action((bucketName, account) => {
			if (!accessDatabase.isRestricted(bucketName)) {
				generalLog.info(`Bucket ${bucketName} is open — all accounts eligible`);
				return;
			}
			generalLog.info(
				accessDatabase.has(bucketName, account)
					? `${account} is a member of ${bucketName}`
					: `${account} is NOT a member of ${bucketName}`
			);
		});

	return access;
}

function makeBucketCommand() {
	const bucket = new Command('bucket');
	bucket.description('Manage usage buckets (limits + fallback priority)');

	bucket
		.command('add')
		.addArgument(new Argument('<name>', 'Bucket name'))
		.addArgument(new Argument('<priority>', 'Fallback priority (lower tried first)'))
		.addArgument(new Argument('<limit_ms>', 'CPU limit per account per window (ms)'))
		.addArgument(new Argument('<limit_kb>', 'NET limit per account per window (kb)'))
		.description('Create or update a bucket')
		.action((name, priority, limit_ms, limit_kb) => {
			const p = Number(priority);
			const ms = Number(limit_ms);
			const kb = Number(limit_kb);
			if (!Number.isInteger(p) || p < 0) {
				generalLog.error('priority must be a non-negative integer');
				return;
			}
			if (!Number.isInteger(ms) || ms <= 0 || !Number.isInteger(kb) || kb <= 0) {
				generalLog.error('limit_ms and limit_kb must be positive integers');
				return;
			}
			policyDatabase.putBucket(name, p, ms, kb);
			generalLog.info(`Bucket ${name} set: priority=${p} limit_ms=${ms} limit_kb=${kb}`);
		});

	bucket
		.command('remove')
		.addArgument(new Argument('<name>', 'Bucket name'))
		.description('Remove a bucket and purge its usage records')
		.action((name) => {
			const refs = bucketInUse(name);
			if (refs.length > 0) {
				generalLog.error(`Bucket ${name} is referenced by rules: ${refs.join(', ')}`);
				return;
			}
			policyDatabase.removeBucket(name);
			const purged = usageDatabase.purgeBucket(name);
			const purgedMembers = accessDatabase.purgeBucket(name);
			generalLog.info(
				`Removed bucket ${name}, purged ${purged} usage records and ${purgedMembers} access list members`
			);
		});

	bucket
		.command('list')
		.description('List buckets')
		.action(() => {
			for (const b of policyDatabase.listBuckets()) {
				generalLog.info(
					`${b.name}: priority=${b.priority} limit_ms=${b.limit_ms} limit_kb=${b.limit_kb} members=${accessDatabase.count(b.name)}`
				);
			}
		});

	bucket.addCommand(makeAccessCommand());

	return bucket;
}

export function makeRulesCommand() {
	const command = new Command('rules');
	command.description('Manage action-matching rules and usage buckets');
	command.addCommand(makeBucketCommand());

	command
		.command('add')
		.addArgument(new Argument('<name>', 'Rule name'))
		.addArgument(new Argument('<bucket>', 'Bucket this rule feeds'))
		.description('Create or update a rule pointing at a bucket')
		.action((name, bucket) => {
			if (!requireBucket(bucket)) return;
			policyDatabase.putRule(name, bucket);
			generalLog.info(`Rule ${name} → bucket ${bucket}`);
		});

	command
		.command('remove')
		.addArgument(new Argument('<name>', 'Rule name'))
		.description('Remove a rule and its patterns')
		.action((name) => {
			policyDatabase.removeRule(name);
			generalLog.info(`Removed rule ${name}`);
		});

	command
		.command('list')
		.description('List rules with their bucket and pattern counts')
		.action(() => {
			for (const r of policyDatabase.listRules()) {
				const patterns = policyDatabase.listPatterns(r.name);
				const allow = patterns.filter((p) => p.kind === 'allow').length;
				const require = patterns.filter((p) => p.kind === 'require').length;
				const flag = patterns.length === 0 ? ' (empty — never matches)' : '';
				generalLog.info(`${r.name} → ${r.bucket} [allow=${allow} require=${require}]${flag}`);
			}
		});

	command
		.command('show')
		.addArgument(new Argument('<name>', 'Rule name'))
		.description('Show a rule and its patterns')
		.action((name) => {
			if (!requireRule(name)) return;
			const patterns = policyDatabase.listPatterns(name);
			generalLog.info(`${name} → ${policyDatabase.getRule(name)?.bucket}`);
			for (const p of patterns) {
				generalLog.info(`  ${p.kind}: ${p.pattern}`);
			}
		});

	const addPattern =
		(kind: 'allow' | 'require') =>
		(name: string, pattern: string): void => {
			if (!requireRule(name)) return;
			try {
				validatePattern(pattern);
			} catch (error) {
				generalLog.error(String(error));
				return;
			}
			policyDatabase.addPattern(name, kind, pattern);
			generalLog.info(`${name}: +${kind} ${pattern}`);
		};

	const removePattern =
		(kind: 'allow' | 'require') =>
		(name: string, pattern: string): void => {
			if (!requireRule(name)) return;
			policyDatabase.removePattern(name, kind, pattern);
			generalLog.info(`${name}: -${kind} ${pattern}`);
		};

	command
		.command('allow')
		.addArgument(new Argument('<name>', 'Rule name'))
		.addArgument(new Argument('<pattern>', 'contract::action pattern'))
		.description('Add an allow pattern')
		.action(addPattern('allow'));

	command
		.command('require')
		.addArgument(new Argument('<name>', 'Rule name'))
		.addArgument(new Argument('<pattern>', 'contract::action pattern'))
		.description('Add a require pattern')
		.action(addPattern('require'));

	command
		.command('unallow')
		.addArgument(new Argument('<name>', 'Rule name'))
		.addArgument(new Argument('<pattern>', 'contract::action pattern'))
		.description('Remove an allow pattern')
		.action(removePattern('allow'));

	command
		.command('unrequire')
		.addArgument(new Argument('<name>', 'Rule name'))
		.addArgument(new Argument('<pattern>', 'contract::action pattern'))
		.description('Remove a require pattern')
		.action(removePattern('require'));

	return command;
}
