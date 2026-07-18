import { PrivateKey } from '@wharfkit/antelope';

import { providerLog } from '$lib/logger';
import { getClient } from '$lib/wharf/client';
import { getProviderSession } from '$lib/wharf/session';
import {
	ANTELOPE_NOOP_CONTRACT,
	ENABLE_FREE_TRANSACTIONS,
	ENABLE_LIGHTACCOUNT_PROVIDER,
	ENABLE_PAID_TRANSACTIONS,
	LIGHTACCOUNT_CONTRACT
} from 'src/config';

export async function validateProviderAccount(): Promise<boolean> {
	const session = await getProviderSession();
	const data = await getClient().v1.chain.get_account(session.actor);

	const permission = data.permissions.find((p) => p.perm_name.equals(session.permission));
	if (!permission) {
		providerLog.error(
			`Provider account "${session.actor}" is missing the "${session.permission}" permission. Run "provider setup" to configure the account.`
		);
		return false;
	}

	const configuredPublicKey = PrivateKey.from(session.walletPlugin.data.privateKey).toPublic();
	const keyMatch = permission.required_auth.keys.some((k) => k.key.equals(configuredPublicKey));
	if (!keyMatch) {
		const onChainKeys = permission.required_auth.keys.map((k) => String(k.key)).join(', ');
		providerLog.error(
			`Provider account "${session.actor}": the configured private key does not match any key on its "${session.permission}" permission. ` +
				`Public key derived from the configured private key: ${configuredPublicKey}. ` +
				`Key(s) currently on the "${session.permission}" permission: ${onChainKeys || 'none'}. ` +
				`Run "provider setup" to update the permission.`
		);
		return false;
	}

	if (ENABLE_FREE_TRANSACTIONS || ENABLE_PAID_TRANSACTIONS) {
		const noopLinked = permission.linked_actions.find(
			(a) => a.account.equals(ANTELOPE_NOOP_CONTRACT) && a.action.equals('noop')
		);
		if (!noopLinked) {
			providerLog.error(
				`Provider account "${session.actor}": permission "${session.permission}" is not linked to ${ANTELOPE_NOOP_CONTRACT}::noop. Run "provider setup" to configure the account.`
			);
			return false;
		}
	}

	if (ENABLE_LIGHTACCOUNT_PROVIDER && LIGHTACCOUNT_CONTRACT) {
		const authkeyLinked = permission.linked_actions.find(
			(a) => a.account.equals(LIGHTACCOUNT_CONTRACT) && a.action.equals('authkey')
		);
		if (!authkeyLinked) {
			providerLog.error(
				`Provider account "${session.actor}": permission "${session.permission}" is not linked to ${LIGHTACCOUNT_CONTRACT}::authkey. Run "provider setup" to configure the account.`
			);
			return false;
		}
	}

	return true;
}
