import { isENVFalse, isENVTrue } from '$lib/utils';

// Base Configuration
export const ENVIRONMENT = process.env.ENVIRONMENT ?? 'production';
export const SERVICE_ERROR_LOG = process.env.SERVICE_ERROR_LOG ?? './error.log';
export const SERVICE_HTTP_PORT = process.env.SERVICE_HTTP_PORT
	? Number(process.env.SERVICE_HTTP_PORT)
	: 3000;
export const SERVICE_INFO_LOG = process.env.SERVICE_INFO_LOG ?? './info.log';
export const SERVICE_LOG_LEVEL = process.env.SERVICE_LOG_LEVEL ?? 'info';

// Database Configuration
export const DATABASE_FILE = process.env.DATABASE_FILE ?? 'resource-provider.db';

// Chain Configuration
export const ANTELOPE_CHAIN_ID = process.env.ANTELOPE_CHAIN_ID;
export const ANTELOPE_NODEOS_API = process.env.ANTELOPE_NODEOS_API;
export const ANTELOPE_NOOP_CONTRACT = process.env.ANTELOPE_NOOP_CONTRACT ?? 'greymassnoop';
export const ANTELOPE_SAMPLE_ACCOUNT = process.env.ANTELOPE_SAMPLE_ACCOUNT ?? 'eosio.reserv';
export const ANTELOPE_SYSTEM_CONTRACT = process.env.ANTELOPE_SYSTEM_CONTRACT ?? 'core.vaulta';
export const ANTELOPE_SYSTEM_TOKEN = process.env.ANTELOPE_SYSTEM_TOKEN ?? '4,A';
export const ANTELOPE_TOKEN_CONTRACT = process.env.ANTELOPE_TOKEN_CONTRACT ?? 'core.vaulta';

// Feature: Automated Resource Management
export const ENABLE_RESOURCE_MANAGER = isENVTrue(process.env.ENABLE_RESOURCE_MANAGER ?? 'false');
export const MANAGER_ACCOUNT_NAME = process.env.MANAGER_ACCOUNT_NAME;
export const MANAGER_ACCOUNT_PERMISSION = process.env.MANAGER_ACCOUNT_PERMISSION;
export const MANAGER_ACCOUNT_PRIVATEKEY = process.env.MANAGER_ACCOUNT_PRIVATEKEY;
export const MANAGER_CRONJOB = process.env.MANAGER_CRONJOB ?? '0/10 * * * * *'; // Cron job pattern: https://croner.56k.guru/usage/pattern/
export const MANAGER_BUYRAM_ENABLED = isENVTrue(process.env.MANAGER_BUYRAM_ENABLED ?? 'true');
export const MANAGER_RAM_MINIMUM_KB = process.env.MANAGER_RAM_MINIMUM_KB
	? Number(process.env.MANAGER_RAM_MINIMUM_KB)
	: 1;
export const MANAGER_BUYRAM_ACTION = process.env.MANAGER_BUYRAM_ACTION ?? 'buyrambytes';
export const MANAGER_MIN_MS = process.env.MANAGER_MIN_MS ? Number(process.env.MANAGER_MIN_MS) : 5;
export const MANAGER_MIN_KB = process.env.MANAGER_MIN_KB ? Number(process.env.MANAGER_MIN_KB) : 5;
export const MANAGER_INC_MS = process.env.MANAGER_INC_MS ? Number(process.env.MANAGER_INC_MS) : 10;
export const MANAGER_INC_KB = process.env.MANAGER_INC_KB ? Number(process.env.MANAGER_INC_KB) : 10;

if (ENABLE_RESOURCE_MANAGER) {
	if (!MANAGER_ACCOUNT_NAME) {
		throw new Error(
			'If ENABLE_RESOURCE_MANAGER is set to true, MANAGER_ACCOUNT_NAME must also be defined.'
		);
	}
}

// Feature: Resource Provider APIs
export const ENABLE_RESOURCE_PROVIDER = isENVTrue(process.env.ENABLE_RESOURCE_PROVIDER ?? 'false');
export const PROVIDER_ACCOUNT_NAME = process.env.PROVIDER_ACCOUNT_NAME;
export const PROVIDER_ACCOUNT_PERMISSION = process.env.PROVIDER_ACCOUNT_PERMISSION;
export const PROVIDER_ACCOUNT_PRIVATEKEY = process.env.PROVIDER_ACCOUNT_PRIVATEKEY;

if (ENABLE_RESOURCE_PROVIDER) {
	if (!PROVIDER_ACCOUNT_NAME) {
		throw new Error(
			'If ENABLE_RESOURCE_PROVIDER is set to true, PROVIDER_ACCOUNT_NAME must also be defined.'
		);
	}
}

// Feature: Resource Provider API - Allow direct free account powerup
export const ENABLE_FREE_POWERUP = isENVTrue(process.env.ENABLE_FREE_POWERUP ?? 'false');

if (ENABLE_FREE_POWERUP) {
	if (!ENABLE_RESOURCE_PROVIDER) {
		throw new Error(
			'If ENABLE_FREE_POWERUP is set to true, ENABLE_RESOURCE_PROVIDER must also be set to true.'
		);
	}
}

// Feature: Resource Provider API - Cosign transactions to provide free resources
export const ENABLE_FREE_TRANSACTIONS = isENVTrue(process.env.ENABLE_FREE_TRANSACTIONS ?? 'false');

if (ENABLE_FREE_TRANSACTIONS) {
	if (!ENABLE_RESOURCE_PROVIDER) {
		throw new Error(
			'If ENABLE_FREE_TRANSACTIONS is set to true, ENABLE_RESOURCE_PROVIDER must also be set to true.'
		);
	}
}

// Feature: Resource Provider API - Usage tracking
export const PROVIDER_USAGE_CLEANUP_CRON = process.env.PROVIDER_USAGE_CLEANUP_CRON ?? '0 * * * *';

// Feature: Resource Provider API - Cosign transactions to fee-based resources
export function defaultPaidTransactions(resourceProviderEnabled: boolean): boolean {
	return resourceProviderEnabled;
}

export const ENABLE_PAID_TRANSACTIONS = isENVTrue(
	process.env.ENABLE_PAID_TRANSACTIONS ?? String(defaultPaidTransactions(ENABLE_RESOURCE_PROVIDER))
);

if (ENABLE_PAID_TRANSACTIONS) {
	if (!ENABLE_RESOURCE_PROVIDER) {
		throw new Error(
			'If ENABLE_PAID_TRANSACTIONS is set to true, ENABLE_RESOURCE_PROVIDER must also be set to true.'
		);
	}
}

// Feature: Light Account Provider
export const ENABLE_LIGHTACCOUNT_PROVIDER = isENVTrue(
	process.env.ENABLE_LIGHTACCOUNT_PROVIDER ?? 'false'
);
export const LIGHTACCOUNT_CONTRACT = process.env.LIGHTACCOUNT_CONTRACT;
export const LIGHTACCOUNT_KEYHOST = process.env.LIGHTACCOUNT_KEYHOST;
export const LIGHTACCOUNT_FEE_MARGIN = process.env.LIGHTACCOUNT_FEE_MARGIN ?? '1.0';
export const LIGHTACCOUNT_FEE_RECIPIENT_KEY = process.env.LIGHTACCOUNT_FEE_RECIPIENT_KEY;

if (ENABLE_LIGHTACCOUNT_PROVIDER) {
	if (!ENABLE_RESOURCE_PROVIDER) {
		throw new Error(
			'If ENABLE_LIGHTACCOUNT_PROVIDER is set to true, ENABLE_RESOURCE_PROVIDER must also be set to true.'
		);
	}
	if (!LIGHTACCOUNT_CONTRACT) {
		throw new Error(
			'If ENABLE_LIGHTACCOUNT_PROVIDER is set to true, LIGHTACCOUNT_CONTRACT must also be defined.'
		);
	}
	if (!LIGHTACCOUNT_KEYHOST) {
		throw new Error(
			'If ENABLE_LIGHTACCOUNT_PROVIDER is set to true, LIGHTACCOUNT_KEYHOST must also be defined.'
		);
	}
	if (!LIGHTACCOUNT_FEE_RECIPIENT_KEY) {
		throw new Error(
			'If ENABLE_LIGHTACCOUNT_PROVIDER is set to true, LIGHTACCOUNT_FEE_RECIPIENT_KEY must also be defined.'
		);
	}
}

export const ENABLE_ADMIN_API = isENVTrue(process.env.ENABLE_ADMIN_API ?? 'false');

if (
	ENABLE_RESOURCE_PROVIDER &&
	!ENABLE_FREE_TRANSACTIONS &&
	!ENABLE_PAID_TRANSACTIONS &&
	!ENABLE_LIGHTACCOUNT_PROVIDER
) {
	throw new Error(
		'ENABLE_RESOURCE_PROVIDER requires at least one of ENABLE_FREE_TRANSACTIONS, ENABLE_PAID_TRANSACTIONS, or ENABLE_LIGHTACCOUNT_PROVIDER to be enabled.'
	);
}

// Feature: Self-Management (auto-PowerUp for the service's own account)
export const ENABLE_SELF_MANAGEMENT = !isENVFalse(process.env.ENABLE_SELF_MANAGEMENT ?? 'true');
export const MANAGER_SELF_CRONJOB = process.env.MANAGER_SELF_CRONJOB ?? '0/30 * * * * *';
export const MANAGER_MAX_FEE = process.env.MANAGER_MAX_FEE ?? '0.1000';

export const explorers: Record<string, string> = {
	aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906: 'https://unicove.com',
	'73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d': 'https://jungle4.unicove.com',
	'4667b205c6838ef70ff7988f6e8257e8be0e1284a2f59699054a018f743b1d11': 'https://telos.unicove.com',
	'1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4': 'https://wax.unicove.com',
	'5fff1dae8dc8e2fc4d5b23b2c7665c97f9e9d8edf2b6485a86ba311c25639191': 'https://kylin.unicove.com'
};
