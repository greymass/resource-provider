import { configDatabase } from '$lib/db/models/config';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { generalLog } from '$lib/logger';
import { invalidatePolicyCache } from '$lib/rules';

export function bootstrapPolicy(): void {
	if (policyDatabase.listBuckets().length > 0) {
		return;
	}
	const ms = configDatabase.get('provider.free_transactions.limit_ms')?.value;
	const kb = configDatabase.get('provider.free_transactions.limit_kb')?.value;
	if (ms === undefined || kb === undefined) {
		return;
	}
	policyDatabase.putBucket('wildcard', 1000, Number(ms), Number(kb));
	policyDatabase.putRule('wildcard', 'wildcard');
	policyDatabase.addPattern('wildcard', 'allow', '*::*');
	invalidatePolicyCache();
	generalLog.info('Seeded wildcard bucket from retired free-transaction limits', {
		limit_ms: ms,
		limit_kb: kb
	});
}
