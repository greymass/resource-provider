import { createMockFetch } from './mock-fetch';

import { runMigrations } from '$lib/db/migrate';
import { policyDatabase } from '$lib/db/models/provider/policy';

const originalFetch = globalThis.fetch;
globalThis.fetch = createMockFetch(originalFetch) as typeof globalThis.fetch;

runMigrations();
policyDatabase.putBucket('wildcard', 1000, 5, 10);
policyDatabase.putRule('wildcard', 'wildcard');
policyDatabase.addPattern('wildcard', 'allow', '*::*');
