import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('accounts', {
	account: text('account').primaryKey(),
	min_ms: integer('min_ms').notNull(),
	min_kb: integer('min_kb').notNull(),
	min_ram_kb: integer('min_ram_kb').notNull().default(0),
	inc_ms: integer('inc_ms').notNull(),
	inc_kb: integer('inc_kb').notNull(),
	inc_ram_kb: integer('inc_ram_kb').notNull().default(0),
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
		created_at: integer('created_at').notNull()
	},
	(table) => [index('idx_usage_account_created').on(table.account, table.created_at)]
);
