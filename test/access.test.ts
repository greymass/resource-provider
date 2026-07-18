import { beforeEach, describe, expect, it } from 'bun:test';

import { database } from '$lib/db';
import { accessDatabase, isValidAccountName } from '$lib/db/models/provider/access';
import * as schema from '$lib/db/schema';

function clear() {
	database.delete(schema.providerBucketAccount).run();
}

describe('isValidAccountName', () => {
	it('accepts valid Antelope names and rejects invalid ones', () => {
		expect(isValidAccountName('alice')).toBeTrue();
		expect(isValidAccountName('eon.shipload')).toBeTrue();
		expect(isValidAccountName('')).toBeFalse();
		expect(isValidAccountName('UPPERCASE')).toBeFalse();
		expect(isValidAccountName('waytoolongaccountname')).toBeFalse();
		expect(isValidAccountName('bad_char')).toBeFalse();
	});
});

describe('accessDatabase', () => {
	beforeEach(clear);

	it('adds members idempotently', () => {
		const first = accessDatabase.add('vip', ['alice', 'bob']);
		expect(first).toEqual({ added: 2, ignored: 0 });
		const again = accessDatabase.add('vip', ['alice', 'carol']);
		expect(again).toEqual({ added: 1, ignored: 1 });
	});

	it('derives restriction from list existence', () => {
		expect(accessDatabase.isRestricted('vip')).toBeFalse();
		accessDatabase.add('vip', ['alice']);
		expect(accessDatabase.isRestricted('vip')).toBeTrue();
		expect(accessDatabase.has('vip', 'alice')).toBeTrue();
		expect(accessDatabase.has('vip', 'bob')).toBeFalse();
	});

	it('reports the empty transition on remove', () => {
		accessDatabase.add('vip', ['alice', 'bob']);
		expect(accessDatabase.remove('vip', ['alice'])).toEqual({ removed: 1, empty: false });
		expect(accessDatabase.remove('vip', ['bob', 'ghost'])).toEqual({ removed: 1, empty: true });
		expect(accessDatabase.isRestricted('vip')).toBeFalse();
	});

	it('counts members per bucket', () => {
		accessDatabase.add('vip', ['alice', 'bob']);
		accessDatabase.add('std', ['carol']);
		expect(accessDatabase.count('vip')).toBe(2);
		expect(accessDatabase.count('std')).toBe(1);
		expect(accessDatabase.count('none')).toBe(0);
	});

	it('paginates the member list by keyset without gaps or repeats', () => {
		const names = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];
		accessDatabase.add('vip', names);
		const one = accessDatabase.list('vip', 2);
		expect(one.accounts.map((r) => r.account)).toEqual(['aaa', 'bbb']);
		expect(one.next).toBe('bbb');
		const two = accessDatabase.list('vip', 2, one.next!);
		expect(two.accounts.map((r) => r.account)).toEqual(['ccc', 'ddd']);
		const three = accessDatabase.list('vip', 2, two.next!);
		expect(three.accounts.map((r) => r.account)).toEqual(['eee']);
		expect(three.next).toBeNull();
	});

	it('reverse-looks-up buckets for an account', () => {
		accessDatabase.add('vip', ['alice']);
		accessDatabase.add('std', ['alice', 'bob']);
		expect(accessDatabase.bucketsForAccount('alice').map((r) => r.bucket)).toEqual(['std', 'vip']);
		expect(accessDatabase.bucketsForAccount('ghost')).toEqual([]);
	});

	it('purges a bucket', () => {
		accessDatabase.add('vip', ['alice', 'bob']);
		expect(accessDatabase.purgeBucket('vip')).toBe(2);
		expect(accessDatabase.isRestricted('vip')).toBeFalse();
	});

	it('stays fast at 100k members (scale smoke test)', () => {
		const accounts: string[] = [];
		for (let i = 0; i < 100_000; i++) {
			accounts.push(`a${i.toString(5).replace(/[0-4]/g, (d) => 'abcde'[Number(d)])}`);
		}
		for (let i = 0; i < accounts.length; i += 5000) {
			accessDatabase.add('big', accounts.slice(i, i + 5000));
		}
		expect(accessDatabase.count('big')).toBe(100_000);
		const start = performance.now();
		accessDatabase.has('big', accounts[99_999]);
		accessDatabase.isRestricted('big');
		accessDatabase.list('big', 1000);
		expect(performance.now() - start).toBeLessThan(100);
	});
});
