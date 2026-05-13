import { describe, expect, it } from 'bun:test';

const { Asset, Int64 } = await import('@wharfkit/antelope');

async function makeManagedAccount(overrides: Record<string, unknown> = {}) {
	const { ManagedAccount } = await import('../src/lib/db/models/manager/account');
	return ManagedAccount.from({
		account: 'test.gm',
		min_ms: Int64.from(10),
		min_kb: Int64.from(10),
		min_ram_kb: Int64.from(10),
		inc_ms: Int64.from(5),
		inc_kb: Int64.from(5),
		inc_ram_kb: Int64.from(5),
		max_fee: Asset.from('0.1000 EOS'),
		...overrides
	});
}

describe('manager RAM resources', () => {
	it('requires RAM when available RAM is below the managed minimum', async () => {
		const { getAccountRequiresRAM } = await import('../src/lib/wharf/resources');
		const managed = await makeManagedAccount();
		const required = getAccountRequiresRAM(managed, {
			cpu: Int64.from(100000),
			net: Int64.from(100000),
			ram: Int64.from(9000)
		});

		expect(required).toBeTrue();
	});

	it('does not require RAM when available RAM is above the managed minimum', async () => {
		const { getAccountRequiresRAM } = await import('../src/lib/wharf/resources');
		const managed = await makeManagedAccount();
		const required = getAccountRequiresRAM(managed, {
			cpu: Int64.from(100000),
			net: Int64.from(100000),
			ram: Int64.from(10000)
		});

		expect(required).toBeFalse();
	});

	it('leaves RAM disabled when no RAM increment is configured', async () => {
		const { getAccountRequiresRAM } = await import('../src/lib/wharf/resources');
		const managed = await makeManagedAccount({
			inc_ram_kb: Int64.zero
		});
		const required = getAccountRequiresRAM(managed, {
			cpu: Int64.from(100000),
			net: Int64.from(100000),
			ram: Int64.zero
		});

		expect(required).toBeFalse();
	});

	it('creates self-managed accounts with RAM management disabled by default', async () => {
		const { getSelfManagedAccount } = await import('../src/lib/self-management');
		const managed = getSelfManagedAccount('manager.gm', {
			minMs: 5,
			minKb: 5,
			incMs: 10,
			incKb: 10,
			maxFee: '0.2500',
			buyramEnabled: true,
			ramMinimumKb: 100
		});

		expect(managed.min_ram_kb.equals(Int64.zero)).toBeTrue();
		expect(managed.inc_ram_kb.equals(Int64.zero)).toBeTrue();
	});
});
