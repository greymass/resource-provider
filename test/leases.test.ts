import { describe, expect, it } from 'bun:test';

import { getLeaseRenewals, type PowerupOrder } from '$lib/wharf/leases';

const now = Date.parse('2026-10-30T15:00:00Z');
const order = (expires: string, cpu: number, net: number): PowerupOrder => ({
	owner: 'test.gm',
	cpu_weight: cpu,
	net_weight: net,
	expires
});

describe('getLeaseRenewals', () => {
	it('renews when the newest lease expires within the window', () => {
		const orders = [order('2026-10-30T16:00:00', 100, 0), order('2026-10-30T15:30:00', 0, 100)];
		expect(getLeaseRenewals(orders, now, 120)).toEqual({ cpuRequired: true, netRequired: true });
	});
	it('does not renew when a newer lease extends past the window', () => {
		const orders = [order('2026-10-30T16:00:00', 100, 100), order('2026-10-31T14:00:00', 100, 0)];
		expect(getLeaseRenewals(orders, now, 120)).toEqual({ cpuRequired: false, netRequired: true });
	});
	it('renews a big expiring NET lease even when a small newer one remains (Nov 1 outage)', () => {
		const orders = [
			order('2026-10-30T15:30:00', 0, 50_000_000),
			order('2026-10-31T09:00:00', 0, 3_000_000),
			order('2026-10-31T14:00:00', 100, 0)
		];
		expect(getLeaseRenewals(orders, now, 120)).toEqual({ cpuRequired: false, netRequired: true });
	});
	it('ignores accounts without leases and a disabled window', () => {
		expect(getLeaseRenewals([], now, 120)).toEqual({ cpuRequired: false, netRequired: false });
		expect(getLeaseRenewals([order('2026-10-30T15:10:00', 1, 1)], now, 0)).toEqual({
			cpuRequired: false,
			netRequired: false
		});
	});
});

describe('self-management uses the shared renewal check', () => {
	it('routes the manager account through getRequiredResourcesWithRenewals', async () => {
		const src = await Bun.file('src/lib/self-management.ts').text();
		expect(src).toContain('getRequiredResourcesWithRenewals(managed, data)');
		const acct = await Bun.file('src/manager/manage/account.ts').text();
		expect(acct).toContain('getRequiredResourcesWithRenewals(managed, data)');
	});
});
