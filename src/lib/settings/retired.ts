import { generalLog } from '$lib/logger';

export const RETIRED_ENV_VARS = [
	'PROVIDER_FREE_TRANSACTIONS_LIMIT_MS',
	'PROVIDER_FREE_TRANSACTIONS_LIMIT_KB',
	'PROVIDER_USAGE_WINDOW_HOURS',
	'PROVIDER_REQUIRE_RESOURCE_NEED',
	'PROVIDER_MIN_CPU_US',
	'PROVIDER_MIN_NET_BYTES',
	'PROVIDER_PAID_TRANSACTIONS_MINIMUM_FEE',
	'PROVIDER_PAID_TRANSACTIONS_FEE_RECIPIENT',
	'PROVIDER_PAID_TRANSACTIONS_FEE_MEMO',
	'PROVIDER_PAID_TRANSACTIONS_FEE_DEFAULT_REF',
	'PROVIDER_FREE_POWERUP_MS',
	'PROVIDER_FREE_POWERUP_KB',
	'PROVIDER_FREE_POWERUP_USES',
	'PROVIDER_FREE_POWERUP_MAX_PAYMENT'
];

export function warnRetiredEnvVars(): void {
	for (const name of RETIRED_ENV_VARS) {
		if (process.env[name] !== undefined) {
			generalLog.warn(
				`Environment variable ${name} is no longer used. Manage this setting with 'rpcli config' instead.`
			);
		}
	}
}
