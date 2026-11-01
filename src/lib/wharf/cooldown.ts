import { MANAGER_POWERUP_COOLDOWN_SECONDS } from 'src/config';

// After a successful powerup, chain-reported limits can lag and lease checks can keep
// firing; skip the account until the cooldown passes so it can't re-buy every cycle.
const lastPowerup = new Map<string, number>();

export function inPowerupCooldown(
	account: string,
	now = Date.now(),
	seconds = MANAGER_POWERUP_COOLDOWN_SECONDS
): boolean {
	const last = lastPowerup.get(account);
	return seconds > 0 && last !== undefined && now - last < seconds * 1000;
}

export function recordPowerup(account: string, now = Date.now()) {
	lastPowerup.set(account, now);
}

export function resetPowerupCooldowns() {
	lastPowerup.clear();
}
