import { and, asc, eq } from 'drizzle-orm';

import { database } from '$lib/db';
import { AbstractDatabase } from '$lib/db/abstract';

export interface BucketRow {
	name: string;
	priority: number;
	limit_ms: number;
	limit_kb: number;
}

export interface RuleRow {
	name: string;
	bucket: string;
}

export interface PatternRow {
	rule: string;
	kind: string;
	pattern: string;
}

export class PolicyDatabase extends AbstractDatabase {
	listBuckets(): BucketRow[] {
		return database
			.select()
			.from(this.schema.providerBucket)
			.orderBy(asc(this.schema.providerBucket.priority), asc(this.schema.providerBucket.name))
			.all();
	}

	getBucket(name: string): BucketRow | undefined {
		return database
			.select()
			.from(this.schema.providerBucket)
			.where(eq(this.schema.providerBucket.name, name))
			.get();
	}

	putBucket(name: string, priority: number, limit_ms: number, limit_kb: number): void {
		database
			.insert(this.schema.providerBucket)
			.values({ name, priority, limit_ms, limit_kb })
			.onConflictDoUpdate({
				target: this.schema.providerBucket.name,
				set: { priority, limit_ms, limit_kb }
			})
			.run();
	}

	removeBucket(name: string): void {
		database
			.delete(this.schema.providerBucket)
			.where(eq(this.schema.providerBucket.name, name))
			.run();
	}

	listRules(): RuleRow[] {
		return database.select().from(this.schema.providerRule).all();
	}

	getRule(name: string): RuleRow | undefined {
		return database
			.select()
			.from(this.schema.providerRule)
			.where(eq(this.schema.providerRule.name, name))
			.get();
	}

	rulesForBucket(name: string): RuleRow[] {
		return database
			.select()
			.from(this.schema.providerRule)
			.where(eq(this.schema.providerRule.bucket, name))
			.all();
	}

	putRule(name: string, bucket: string): void {
		database
			.insert(this.schema.providerRule)
			.values({ name, bucket })
			.onConflictDoUpdate({ target: this.schema.providerRule.name, set: { bucket } })
			.run();
	}

	putRuleDocument(name: string, bucket: string, allow: string[], require: string[]): void {
		database.transaction((transaction) => {
			transaction
				.insert(this.schema.providerRule)
				.values({ name, bucket })
				.onConflictDoUpdate({ target: this.schema.providerRule.name, set: { bucket } })
				.run();
			this.replacePatternsWith(transaction, name, allow, require);
		});
	}

	removeRule(name: string): void {
		database.transaction((transaction) => {
			transaction
				.delete(this.schema.providerRulePattern)
				.where(eq(this.schema.providerRulePattern.rule, name))
				.run();
			transaction
				.delete(this.schema.providerRule)
				.where(eq(this.schema.providerRule.name, name))
				.run();
		});
	}

	listPatterns(rule: string): PatternRow[] {
		return database
			.select()
			.from(this.schema.providerRulePattern)
			.where(eq(this.schema.providerRulePattern.rule, rule))
			.all();
	}

	addPattern(rule: string, kind: string, pattern: string): void {
		database
			.insert(this.schema.providerRulePattern)
			.values({ rule, kind, pattern })
			.onConflictDoNothing()
			.run();
	}

	replacePatterns(rule: string, allow: string[], require: string[]): void {
		database.transaction((transaction) => {
			this.replacePatternsWith(transaction, rule, allow, require);
		});
	}

	private replacePatternsWith(
		writer: Pick<typeof database, 'delete' | 'insert'>,
		rule: string,
		allow: string[],
		require: string[]
	): void {
		writer
			.delete(this.schema.providerRulePattern)
			.where(eq(this.schema.providerRulePattern.rule, rule))
			.run();
		const rows = [
			...allow.map((pattern) => ({ rule, kind: 'allow', pattern })),
			...require.map((pattern) => ({ rule, kind: 'require', pattern }))
		];
		if (rows.length > 0) {
			writer.insert(this.schema.providerRulePattern).values(rows).onConflictDoNothing().run();
		}
	}

	removePattern(rule: string, kind: string, pattern: string): void {
		database
			.delete(this.schema.providerRulePattern)
			.where(
				and(
					eq(this.schema.providerRulePattern.rule, rule),
					eq(this.schema.providerRulePattern.kind, kind),
					eq(this.schema.providerRulePattern.pattern, pattern)
				)
			)
			.run();
	}
}

export const policyDatabase = new PolicyDatabase();
