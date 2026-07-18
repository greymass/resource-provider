import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('accounts', {
	account: text('account').primaryKey(),
	min_ms: integer('min_ms').notNull(),
	min_kb: integer('min_kb').notNull(),
	inc_ms: integer('inc_ms').notNull(),
	inc_kb: integer('inc_kb').notNull(),
	max_fee: text('max_fee').notNull()
});

export const manager = sqliteTable('manager', {
	account: text('account').primaryKey(),
	permission: text('permission').notNull(),
	key: text('key').notNull()
});

export const provider = sqliteTable('provider', {
	account: text('account').primaryKey(),
	permission: text('permission').notNull(),
	key: text('key').notNull()
});

export const usage = sqliteTable(
	'usage',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		account: text('account').notNull(),
		cpu: integer('cpu').notNull(),
		net: integer('net').notNull(),
		bucket: text('bucket').notNull().default('wildcard'),
		created_at: integer('created_at').notNull()
	},
	(table) => [
		index('idx_usage_account_created').on(table.account, table.created_at),
		index('idx_usage_account_bucket_created').on(table.account, table.bucket, table.created_at)
	]
);

export const config = sqliteTable(
	'config',
	{
		scope: text('scope').notNull().default('global'),
		key: text('key').notNull(),
		value: text('value').notNull(),
		updated_at: integer('updated_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.scope, table.key] })]
);

export const providerBucket = sqliteTable('provider_bucket', {
	name: text('name').primaryKey(),
	priority: integer('priority').notNull(),
	limit_ms: integer('limit_ms').notNull(),
	limit_kb: integer('limit_kb').notNull()
});

export const providerRule = sqliteTable('provider_rule', {
	name: text('name').primaryKey(),
	bucket: text('bucket').notNull()
});

export const providerRulePattern = sqliteTable(
	'provider_rule_pattern',
	{
		rule: text('rule').notNull(),
		kind: text('kind').notNull(),
		pattern: text('pattern').notNull()
	},
	(table) => [primaryKey({ columns: [table.rule, table.kind, table.pattern] })]
);

export const tokens = sqliteTable('tokens', {
	name: text('name').primaryKey(),
	hash: text('hash').notNull().unique(),
	level: text('level').notNull(),
	created_at: integer('created_at').notNull(),
	last_used_at: integer('last_used_at')
});

export const providerBucketAccount = sqliteTable(
	'provider_bucket_account',
	{
		bucket: text('bucket').notNull(),
		account: text('account').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.bucket, table.account] }),
		index('idx_bucket_account_account').on(table.account)
	]
);
