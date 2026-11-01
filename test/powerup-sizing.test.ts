import { API, Asset, Int64 } from '@wharfkit/antelope';
import { describe, expect, it } from 'bun:test';

import { ManagedAccount } from '$lib/db/models/manager/account';
import { inPowerupCooldown, recordPowerup, resetPowerupCooldowns } from '$lib/wharf/cooldown';
import { getPurchaseAmounts } from '$lib/wharf/resources';

const managed = ManagedAccount.from({
	account: 'rngfront.gm',
	min_ms: Int64.from(5),
	min_kb: Int64.from(5),
	inc_ms: Int64.from(10),
	inc_kb: Int64.from(10),
	max_fee: Asset.from('0.2500 EOS')
});
const limit = (max: number, used: number) => ({ used, available: 0, max, current_used: used });
const account = (cpu: [number, number], net: [number, number]) =>
	({
		account_name: 'rngfront.gm',
		cpu_limit: { ...limit(...cpu), max: Int64.from(cpu[0]), current_used: Int64.from(cpu[1]) },
		net_limit: { ...limit(...net), max: Int64.from(net[0]), current_used: Int64.from(net[1]) },
		ram_quota: Int64.from(10000),
		ram_usage: Int64.from(5000)
	}) as unknown as API.v1.AccountObject;

describe('getPurchaseAmounts', () => {
	it('buys the deficit plus the increment when far below zero (Nov 1 rngfront.gm)', () => {
		// 690,319 max vs 801,239 used: 110,920 us short, minimum 5,000 us
		const data = account([690319, 801239], [462464, 375689]);
		const { ms, kb } = getPurchaseAmounts(managed, data, { cpuRequired: true, netRequired: false });
		expect(Number(ms)).toBe(10 + Math.ceil((5000 + 110920) / 1000));
		expect(Number(kb)).toBe(10);
	});
	it('buys just the increment when above the minimum (expiry renewal)', () => {
		const data = account([100000, 10000], [100000, 10000]);
		const { ms, kb } = getPurchaseAmounts(managed, data, { cpuRequired: true, netRequired: true });
		expect(Number(ms)).toBe(10);
		expect(Number(kb)).toBe(10);
	});
});

describe('powerup cooldown', () => {
	it('blocks re-buying within the window and allows it after', () => {
		resetPowerupCooldowns();
		expect(inPowerupCooldown('a.gm', 0, 300)).toBe(false);
		recordPowerup('a.gm', 1000);
		expect(inPowerupCooldown('a.gm', 1000 + 299_000, 300)).toBe(true);
		expect(inPowerupCooldown('a.gm', 1000 + 300_000, 300)).toBe(false);
		expect(inPowerupCooldown('b.gm', 2000, 300)).toBe(false);
		expect(inPowerupCooldown('a.gm', 2000, 0)).toBe(false);
	});
});
