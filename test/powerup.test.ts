import { describe, expect, it } from 'bun:test';

import { Int64 } from '@wharfkit/antelope';

describe('powerup billable precision', () => {
	it('scales small resource requests until they are billable', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(10),
			true,
			(amount) => amount * 0.000004,
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(40))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.0001);
	});

	it('preserves larger requests that are already billable', async () => {
		const { getMinimumBillablePowerupAmount } = await import('../src/lib/wharf/actions/powerup');
		const adjusted = getMinimumBillablePowerupAmount(
			Int64.from(30),
			true,
			(amount) => amount * 0.000004,
			'cpu'
		);

		expect(adjusted.amount.equals(Int64.from(30))).toBeTrue();
		expect(adjusted.cost).toBeGreaterThanOrEqual(0.0001);
	});
});
