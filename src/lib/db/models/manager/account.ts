import { Asset, Int64, Name, NameType, Struct } from '@wharfkit/antelope';
import { eq } from 'drizzle-orm';
import { Static } from 'elysia';

import { v2ManagedAccountType } from '$api/v2/manager/types';
import { database } from '$lib/db';
import { AbstractDatabase } from '$lib/db/abstract';
import * as schema from '$lib/db/schema';

@Struct.type('managed_account')
export class ManagedAccount extends Struct {
	// The account name to manage
	@Struct.field(Name) declare account: Name;

	// Minimum CPU in milliseconds, NET in kilobytes, and RAM in kilobytes before resources are added
	@Struct.field(Int64) declare min_ms: Int64;
	@Struct.field(Int64) declare min_kb: Int64;
	@Struct.field(Int64) declare min_ram_kb: Int64;

	// CPU increment in milliseconds, NET increment in kilobytes, and RAM increment in kilobytes
	@Struct.field(Int64) declare inc_ms: Int64;
	@Struct.field(Int64) declare inc_kb: Int64;
	@Struct.field(Int64) declare inc_ram_kb: Int64;

	// Maximum fee allowed for a single powerup
	@Struct.field(Asset) declare max_fee: Asset;

	toJSON(): typeof schema.users.$inferInsert {
		return {
			account: String(this.account),
			min_ms: Number(this.min_ms),
			min_kb: Number(this.min_kb),
			min_ram_kb: Number(this.min_ram_kb),
			inc_ms: Number(this.inc_ms),
			inc_kb: Number(this.inc_kb),
			inc_ram_kb: Number(this.inc_ram_kb),
			max_fee: String(this.max_fee)
		};
	}
}

export type ManagedAccountType = ManagedAccount | typeof schema.users.$inferInsert;

export class ManagedAccountDatabase extends AbstractDatabase {
	async addManagedAccount(data: ManagedAccountType) {
		const source = data instanceof ManagedAccount ? data.toJSON() : data;
		const account = ManagedAccount.from({
			min_ram_kb: 0,
			inc_ram_kb: 0,
			...source
		});
		return database.insert(this.schema.users).values(account.toJSON()).onConflictDoUpdate({
			target: this.schema.users.account,
			set: account.toJSON()
		});
	}

	async removeManagedAccount(account: NameType) {
		return database.delete(this.schema.users).where(eq(this.schema.users.account, String(account)));
	}

	async getManagedAccounts(): Promise<Array<Static<typeof v2ManagedAccountType>>> {
		return database.select().from(this.schema.users);
	}
}

export const managedAccounts = new ManagedAccountDatabase();
