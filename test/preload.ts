import { createMockFetch } from './mock-fetch';

const originalFetch = globalThis.fetch;
globalThis.fetch = createMockFetch(originalFetch) as typeof globalThis.fetch;

process.env.ENVIRONMENT ??= 'testing';
process.env.ANTELOPE_CHAIN_ID ??=
	'73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d';
process.env.ANTELOPE_NODEOS_API ??= 'https://jungle4.greymass.com';
process.env.DATABASE_FILE ??= 'testing.sqlite';
process.env.SERVICE_HTTP_PORT ??= '0';
process.env.ENABLE_RESOURCE_PROVIDER ??= 'true';
process.env.PROVIDER_ACCOUNT_NAME ??= 'providertst1';
process.env.PROVIDER_ACCOUNT_PERMISSION ??= 'cosign';
process.env.PROVIDER_ACCOUNT_PRIVATEKEY ??= '5Jtoxgny5tT7NiNFp1MLogviuPJ9NniWjnU4wKzaX4t7pL4kJ8s';
process.env.PROVIDER_REQUIRE_RESOURCE_NEED ??= 'false';
process.env.ENABLE_FREE_TRANSACTIONS ??= 'true';
process.env.PROVIDER_FREE_TRANSACTIONS_LIMIT_MS ??= '100';
process.env.PROVIDER_FREE_TRANSACTIONS_LIMIT_KB ??= '100';
process.env.ENABLE_PAID_TRANSACTIONS ??= 'true';
process.env.PROVIDER_PAID_TRANSACTIONS_MINIMUM_FEE ??= '0.0001 A';

const { runMigrations } = await import('$lib/db/migrate');

await runMigrations();
