import { describe, expect, it } from 'bun:test';

import { bucketInUse } from '../src/cli/rules';

import { policyDatabase } from '$lib/db/models/provider/policy';
import { usageDatabase } from '$lib/db/models/provider/usage';

describe('policyDatabase buckets', () => {
	it('puts and gets a bucket', () => {
		policyDatabase.putBucket('t_ship', 10, 100, 100);
		const b = policyDatabase.getBucket('t_ship');
		expect(b).toEqual({ name: 't_ship', priority: 10, limit_ms: 100, limit_kb: 100 });
	});
	it('upserts a bucket', () => {
		policyDatabase.putBucket('t_ship', 10, 100, 100);
		policyDatabase.putBucket('t_ship', 5, 200, 200);
		expect(policyDatabase.getBucket('t_ship')).toEqual({
			name: 't_ship',
			priority: 5,
			limit_ms: 200,
			limit_kb: 200
		});
	});
	it('lists buckets ordered by priority then name', () => {
		policyDatabase.putBucket('t_a', 1000, 20, 20);
		policyDatabase.putBucket('t_ship', 5, 200, 200);
		const names = policyDatabase.listBuckets().map((b) => b.name);
		expect(names.indexOf('t_ship')).toBeLessThan(names.indexOf('t_a'));
	});
	it('removes a bucket', () => {
		policyDatabase.putBucket('t_gone', 1, 1, 1);
		policyDatabase.removeBucket('t_gone');
		expect(policyDatabase.getBucket('t_gone')).toBeUndefined();
	});
});

describe('policyDatabase rules and patterns', () => {
	it('puts a rule and reports references for its bucket', () => {
		policyDatabase.putBucket('t_ship', 10, 100, 100);
		policyDatabase.putRule('t_game', 't_ship');
		expect(policyDatabase.getRule('t_game')?.bucket).toBe('t_ship');
		expect(policyDatabase.rulesForBucket('t_ship').map((r) => r.name)).toContain('t_game');
	});
	it('adds, lists, and removes patterns', () => {
		policyDatabase.putRule('t_game', 't_ship');
		policyDatabase.addPattern('t_game', 'allow', 'eon.shipload::*');
		policyDatabase.addPattern('t_game', 'require', 'eon.shipload::placeentity');
		const patterns = policyDatabase.listPatterns('t_game');
		expect(patterns).toContainEqual({ rule: 't_game', kind: 'allow', pattern: 'eon.shipload::*' });
		policyDatabase.removePattern('t_game', 'allow', 'eon.shipload::*');
		expect(policyDatabase.listPatterns('t_game').map((p) => p.pattern)).not.toContain(
			'eon.shipload::*'
		);
	});
	it('removing a rule deletes its patterns', () => {
		policyDatabase.putRule('t_game', 't_ship');
		policyDatabase.addPattern('t_game', 'allow', 'nex.shipload::*');
		policyDatabase.removeRule('t_game');
		expect(policyDatabase.getRule('t_game')).toBeUndefined();
		expect(policyDatabase.listPatterns('t_game')).toHaveLength(0);
	});
});

describe('usageDatabase buckets', () => {
	it('tracks usage per bucket and reads it back', async () => {
		await usageDatabase.incrementUsage('t_acct', 100, 50, 't_ship');
		await usageDatabase.incrementUsage('t_acct', 30, 10, 't_wild');
		expect(usageDatabase.getBucketUsage('t_acct', 't_ship')).toEqual({ cpu: 100, net: 50 });
		expect(usageDatabase.getBucketUsage('t_acct', 't_wild')).toEqual({ cpu: 30, net: 10 });
		expect(usageDatabase.getBucketUsage('t_acct', 't_none')).toEqual({ cpu: 0, net: 0 });
	});
	it('summarizes usage grouped by bucket', async () => {
		await usageDatabase.incrementUsage('t_sum', 100, 50, 't_ship');
		await usageDatabase.incrementUsage('t_sum', 100, 50, 't_ship');
		const byBucket = usageDatabase.getUsageByBucket('t_sum');
		const ship = byBucket.find((b) => b.bucket === 't_ship');
		expect(ship).toEqual({ bucket: 't_ship', cpu: 200, net: 100 });
	});
	it('purges usage rows for a bucket', async () => {
		await usageDatabase.incrementUsage('t_purge', 5, 5, 't_dead');
		expect(usageDatabase.purgeBucket('t_dead')).toBeGreaterThan(0);
		expect(usageDatabase.getBucketUsage('t_purge', 't_dead')).toEqual({ cpu: 0, net: 0 });
	});
});

describe('rules CLI helpers', () => {
	it('reports rules that reference a bucket', () => {
		policyDatabase.putBucket('t_ship', 10, 100, 100);
		policyDatabase.putRule('t_game', 't_ship');
		expect(bucketInUse('t_ship')).toContain('t_game');
		policyDatabase.removeRule('t_game');
		expect(bucketInUse('t_ship')).toHaveLength(0);
	});
});
