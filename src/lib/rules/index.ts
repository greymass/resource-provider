import { Name } from '@wharfkit/antelope';

import { policyDatabase } from '$lib/db/models/provider/policy';
import { generalLog } from '$lib/logger';

export interface PolicyBucket {
	name: string;
	priority: number;
	limit_ms: number;
	limit_kb: number;
}

export interface PolicyRule {
	name: string;
	bucket: string;
	allow: string[];
	require: string[];
}

export interface Policy {
	buckets: PolicyBucket[];
	rules: PolicyRule[];
}

export interface MatchAction {
	account: string;
	name: string;
}

function validNameOrWildcard(segment: string): boolean {
	if (segment === '*') {
		return true;
	}
	try {
		return String(Name.from(segment)) === segment && segment.length > 0;
	} catch {
		return false;
	}
}

export function validatePattern(pattern: string): void {
	const parts = pattern.split('::');
	if (parts.length !== 2 || !validNameOrWildcard(parts[0]) || !validNameOrWildcard(parts[1])) {
		throw new Error(
			`Invalid pattern '${pattern}'. Expected '<contract>::<action>' with names or '*'.`
		);
	}
}

export function actionMatches(pattern: string, action: MatchAction): boolean {
	const [contract, name] = pattern.split('::');
	return (
		(contract === '*' || contract === action.account) && (name === '*' || name === action.name)
	);
}

export function ruleMatches(rule: PolicyRule, actions: MatchAction[]): boolean {
	if (actions.length === 0) {
		return false;
	}
	const coverage = [...rule.allow, ...rule.require];
	const covered = actions.every((action) => coverage.some((p) => actionMatches(p, action)));
	if (!covered) {
		return false;
	}
	return rule.require.every((p) => actions.some((action) => actionMatches(p, action)));
}

export function resolveCandidateBuckets(policy: Policy, actions: MatchAction[]): PolicyBucket[] {
	const bucketNames = new Set<string>();
	for (const rule of policy.rules) {
		if (ruleMatches(rule, actions)) {
			bucketNames.add(rule.bucket);
		}
	}
	return policy.buckets
		.filter((b) => bucketNames.has(b.name))
		.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

export function resolveFreeGrant(
	policy: Policy,
	actions: MatchAction[],
	needs: { cpu: number; net: number },
	billed: string[],
	usageLookup: (account: string, bucket: string) => { cpu: number; net: number },
	accessLookup: (account: string, bucket: string) => boolean
): Array<{ account: string; bucket: string }> | null {
	const candidates = resolveCandidateBuckets(policy, actions);
	if (candidates.length === 0) {
		return null;
	}
	const assignments: Array<{ account: string; bucket: string }> = [];
	for (const account of billed) {
		const fit = candidates.find((bucket) => {
			if (!accessLookup(account, bucket.name)) {
				return false;
			}
			const usage = usageLookup(account, bucket.name);
			return (
				usage.cpu + needs.cpu <= bucket.limit_ms * 1000 &&
				usage.net + needs.net <= bucket.limit_kb * 1000
			);
		});
		if (!fit) {
			return null;
		}
		assignments.push({ account, bucket: fit.name });
	}
	return assignments;
}

const CACHE_TTL_MS = Number(process.env.RULES_CACHE_TTL_MS ?? 5000);

let snapshot: Policy | undefined;
let loadedAt = 0;

export function invalidatePolicyCache(): void {
	snapshot = undefined;
}

export function loadPolicy(): Policy {
	const now = Date.now();
	if (snapshot && now - loadedAt <= CACHE_TTL_MS) {
		return snapshot;
	}
	try {
		const buckets = policyDatabase.listBuckets();
		const rules = policyDatabase.listRules().map((rule) => {
			const patterns = policyDatabase.listPatterns(rule.name);
			return {
				name: rule.name,
				bucket: rule.bucket,
				allow: patterns.filter((p) => p.kind === 'allow').map((p) => p.pattern),
				require: patterns.filter((p) => p.kind === 'require').map((p) => p.pattern)
			};
		});
		snapshot = { buckets, rules };
		loadedAt = now;
	} catch (error) {
		if (!snapshot) {
			throw error;
		}
		generalLog.error('Failed to refresh policy, serving stale snapshot', { error: String(error) });
	}
	return snapshot;
}
