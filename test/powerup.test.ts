import { describe, expect, it } from 'bun:test';

import { Int64 } from '@wharfkit/antelope';

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
});
