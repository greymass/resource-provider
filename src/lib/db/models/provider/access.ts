import { Name } from '@wharfkit/antelope';
import type { Changes } from 'bun:sqlite';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';

import { database } from '$lib/db';
import { AbstractDatabase } from '$lib/db/abstract';

export interface MemberRow {
	account: string;
}

export interface MembershipRow {
	bucket: string;
}

export function isValidAccountName(account: string): boolean {
	try {
		return account.length > 0 && String(Name.from(account)) === account;
	} catch {
		return false;
	}
}

const CHUNK = 1000;

export class AccessDatabase extends AbstractDatabase {
	add(bucket: string, accounts: string[]): { added: number; ignored: number } {
		let added = 0;
		database.transaction((transaction) => {
			for (let i = 0; i < accounts.length; i += CHUNK) {
				const rows = accounts.slice(i, i + CHUNK).map((account) => ({ bucket, account }));
				added += (
					transaction
						.insert(this.schema.providerBucketAccount)
						.values(rows)
						.onConflictDoNothing()
						.run() as unknown as Changes
				).changes;
			}
		});
		return { added, ignored: accounts.length - added };
	}

	remove(bucket: string, accounts: string[]): { removed: number; empty: boolean } {
		let removed = 0;
		database.transaction((transaction) => {
			for (let i = 0; i < accounts.length; i += CHUNK) {
				removed += (
					transaction
						.delete(this.schema.providerBucketAccount)
						.where(
							and(
								eq(this.schema.providerBucketAccount.bucket, bucket),
								inArray(this.schema.providerBucketAccount.account, accounts.slice(i, i + CHUNK))
							)
						)
						.run() as unknown as Changes
				).changes;
			}
		});
		return { removed, empty: !this.isRestricted(bucket) };
	}

	has(bucket: string, account: string): boolean {
		return (
			database
				.select({ account: this.schema.providerBucketAccount.account })
				.from(this.schema.providerBucketAccount)
				.where(
					and(
						eq(this.schema.providerBucketAccount.bucket, bucket),
						eq(this.schema.providerBucketAccount.account, account)
					)
				)
				.get() !== undefined
		);
	}

	isRestricted(bucket: string): boolean {
		return (
			database
				.select({ account: this.schema.providerBucketAccount.account })
				.from(this.schema.providerBucketAccount)
				.where(eq(this.schema.providerBucketAccount.bucket, bucket))
				.limit(1)
				.get() !== undefined
		);
	}

	count(bucket: string): number {
		const row = database
			.select({ value: sql<number>`count(*)` })
			.from(this.schema.providerBucketAccount)
			.where(eq(this.schema.providerBucketAccount.bucket, bucket))
			.get();
		return row?.value ?? 0;
	}

	list(
		bucket: string,
		limit: number,
		after?: string
	): { accounts: MemberRow[]; next: string | null } {
		const conditions = [eq(this.schema.providerBucketAccount.bucket, bucket)];
		if (after !== undefined) {
			conditions.push(gt(this.schema.providerBucketAccount.account, after));
		}
		const rows = database
			.select({
				account: this.schema.providerBucketAccount.account
			})
			.from(this.schema.providerBucketAccount)
			.where(and(...conditions))
			.orderBy(asc(this.schema.providerBucketAccount.account))
			.limit(limit + 1)
			.all();
		const page = rows.slice(0, limit);
		return { accounts: page, next: rows.length > limit ? page[page.length - 1].account : null };
	}

	bucketsForAccount(account: string): MembershipRow[] {
		return database
			.select({
				bucket: this.schema.providerBucketAccount.bucket
			})
			.from(this.schema.providerBucketAccount)
			.where(eq(this.schema.providerBucketAccount.account, account))
			.orderBy(asc(this.schema.providerBucketAccount.bucket))
			.all();
	}

	purgeBucket(bucket: string): number {
		return (
			database
				.delete(this.schema.providerBucketAccount)
				.where(eq(this.schema.providerBucketAccount.bucket, bucket))
				.run() as unknown as Changes
		).changes;
	}
}

export const accessDatabase = new AccessDatabase();
