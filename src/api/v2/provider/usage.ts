import { accessDatabase } from '$lib/db/models/provider/access';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { getInt } from '$lib/settings';

export async function usage({
	params,
	set
}: {
	params: { account: string };
	set: { headers: Record<string, string | number> };
}) {
	set.headers['cache-control'] = 'no-store';
	const byBucket = usageDatabase.getUsageByBucket(params.account);
	const buckets = policyDatabase.listBuckets().map((b) => {
		const used = byBucket.find((u) => u.bucket === b.name);
		const restricted = accessDatabase.isRestricted(b.name);
		return {
			bucket: b.name,
			usage: { cpu: used?.cpu ?? 0, net: used?.net ?? 0 },
			limit: { cpu: b.limit_ms * 1000, net: b.limit_kb * 1000 },
			restricted,
			eligible: !restricted || accessDatabase.has(b.name, params.account)
		};
	});

	return {
		account: params.account,
		window: { hours: getInt('provider.usage.window_hours') },
		buckets
	};
}
