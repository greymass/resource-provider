import { SampleUsage, PowerUpState } from '@wharfkit/resources';

import { ManagedAccountDatabase, managedAccounts } from '$lib/db/models/manager/account';
import type { ManagedAccountDTO } from '$lib/managed-accounts';
import { getSampledUsage, getResourcesClient } from '$lib/wharf/resources';

export interface ManagerContext {
	db: ManagedAccountDatabase;
	managedAccounts: ManagedAccountDTO[];
	sampleUsage: SampleUsage;
	powerup: PowerUpState;
}

export async function getManagerContext(): Promise<ManagerContext> {
	return {
		db: managedAccounts,
		managedAccounts: await managedAccounts.getManagedAccounts(),
		sampleUsage: await getSampledUsage(),
		powerup: await getResourcesClient().v1.powerup.get_state()
	};
}
