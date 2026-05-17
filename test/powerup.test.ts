import { describe, expect, it } from 'bun:test';

const { Asset, Int64, Name } = await import('@wharfkit/antelope');

function makePowerupResource() {
	return {
		weight: Int64.from('99000000000000'),
		utilization: Int64.from('70315521748'),
		adjusted_utilization: Int64.from('51647489007'),
		exponent: { value: 2 },
		min_price: Asset.from('1000.0000 EOS'),
		max_price: Asset.from('150000.0000 EOS'),
		determine_adjusted_utilization() {
			return this.adjusted_utilization;
		},
		frac_by_kb(_sample: unknown, kilobytes: number) {
			return Int64.from(Math.floor(kilobytes * 6551.5));
		},
		frac_by_ms(_sample: unknown, milliseconds: number) {
			return Int64.from(Math.floor(milliseconds * 6551.5));
		},
		price_per_kb() {
			throw new Error('price_per_kb should not be used for minimum NET search');
		},
		price_per_ms() {
			throw new Error('price_per_ms should not be used for minimum CPU search');
		}
	};
}

describe('powerup billable precision', () => {
	it('scales small resource requests until they are billable', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(10),
			true,
			0.0001,
			(amount) => amount * 0.000004,
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(26))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.0001);
	});

	it('preserves larger requests that are already billable', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(30),
			true,
			0.0001,
			(amount) => amount * 0.000004,
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(30))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.0001);
	});

	it('retries when pricing throws below-precision errors', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(10),
			true,
			0.0001,
			(amount) => {
				if (amount < 40) {
					throw new Error(
						'Price (0.0000 EOS) for requested CPU amount (10000us) below required precision, increase requested amount.'
					);
				}

				return amount * 0.000004;
			},
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(40))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.0001);
	});

	it('honors the provided minimum cost threshold', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(10),
			true,
			0.1,
			(amount) => amount * 0.0001,
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(1000))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.1);
	});

	it('scales net-only requests until they are billable', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(10),
			true,
			0.1,
			(amount) => amount * 0.00001,
			'net'
		);

		expect(adjusted.amount.equals(Int64.from(10000))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.1);
	});

	it('finds the minimum billable Jungle 4 NET amount without overflowing', async () => {
		const { getMinimumBillablePowerupAmount, getPowerupResourceCost } = await import(
			'../src/lib/wharf/actions/powerup'
		);
		const resource = makePowerupResource();
		const getCost = (amount: number) =>
			getPowerupResourceCost(resource, resource.frac_by_kb({}, amount));
		const adjusted = getMinimumBillablePowerupAmount(Int64.from(10), true, 0.1, getCost, 'net');
		const previousAmount = adjusted.amount.subtracting(Int64.from(1));

		expect(Number(String(adjusted.amount))).toBeLessThan(20_000_000);
		expect(adjusted.cost).toBe(0.1);
		expect(getCost(Number(String(previousAmount)))).toBeLessThan(0.1);
	});

	it('builds NET params without using the package price_per_kb path', async () => {
		const { getPowerupParamsNET } = await import('../src/lib/wharf/actions/powerup');
		const resource = makePowerupResource();
		const result = getPowerupParamsNET(
			Int64.from(10),
			{ net: resource } as never,
			{} as never,
			{ cpuRequired: false, netRequired: true },
			0.1
		);

		expect(result.net_frac.gt(Int64.zero)).toBeTrue();
		expect(result.net_cost.value).toBe(0.1);
	});

	it('keeps the configured max payment on managed powerups', async () => {
		const { getPowerupParams } = await import('../src/lib/wharf/actions/powerup');
		const resource = makePowerupResource();
		const result = getPowerupParams(
			Int64.from(10),
			Int64.from(0),
			{ min_powerup_fee: Asset.from('0.1000 EOS'), cpu: resource, net: resource } as never,
			{} as never,
			{ cpuRequired: true, netRequired: false },
			Name.from('rsfui4ahy.gm'),
			Name.from('osqj2xldy.gm'),
			Asset.from('0.1000 EOS')
		);

		expect(result.cpu_frac.gt(Int64.zero)).toBeTrue();
		expect(String(result.max_payment)).toBe('0.1000 EOS');
	});

	it('rejects configured max payments below the chain minimum', async () => {
		const { getPowerupParams } = await import('../src/lib/wharf/actions/powerup');
		const resource = makePowerupResource();

		expect(() =>
			getPowerupParams(
				Int64.from(10),
				Int64.from(0),
				{ min_powerup_fee: Asset.from('0.1000 EOS'), cpu: resource, net: resource } as never,
				{} as never,
				{ cpuRequired: true, netRequired: false },
				Name.from('rsfui4ahy.gm'),
				Name.from('osqj2xldy.gm'),
				Asset.from('0.0999 EOS')
			)
		).toThrow('below the required minimum powerup fee target');
	});
});
