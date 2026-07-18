import { getDefinition, parseSetting, registry } from './registry';
import type { SettingDefinition, SettingValue } from './registry';

import { configDatabase } from '$lib/db/models/config';
import { generalLog } from '$lib/logger';

const CACHE_TTL_MS = Number(process.env.SETTINGS_CACHE_TTL_MS ?? 5000);

let snapshot: Map<string, string> | undefined;
let loadedAt = 0;

function requireDefinition(key: string): SettingDefinition {
	const def = getDefinition(key);
	if (!def) {
		const valid = registry.map((d) => d.key).join(', ');
		throw new Error(`Unknown setting '${key}'. Valid keys: ${valid}`);
	}
	return def;
}

function refreshIfStale(): Map<string, string> {
	const now = Date.now();
	if (snapshot && loadedAt > 0 && now - loadedAt <= CACHE_TTL_MS) {
		return snapshot;
	}
	try {
		snapshot = new Map(configDatabase.getAll().map((row) => [row.key, row.value]));
		loadedAt = now;
	} catch (error) {
		if (!snapshot) {
			throw error;
		}
		generalLog.error('Failed to refresh settings, serving stale snapshot', {
			error: String(error)
		});
	}
	return snapshot;
}

export function invalidateSettingsCache(): void {
	snapshot = undefined;
	loadedAt = -1;
}

export function getSetting(key: string): SettingValue | undefined {
	const def = requireDefinition(key);
	const raw = refreshIfStale().get(def.key) ?? def.default;
	if (raw === undefined) {
		return undefined;
	}
	return parseSetting(def, raw);
}

export function getInt(key: string): number {
	const value = getSetting(key);
	if (typeof value !== 'number') {
		throw new Error(`Setting '${key}' is not set`);
	}
	return value;
}

export function getBool(key: string): boolean {
	const value = getSetting(key);
	if (typeof value !== 'boolean') {
		throw new Error(`Setting '${key}' is not set`);
	}
	return value;
}

export function getString(key: string): string | undefined {
	const value = getSetting(key);
	if (value === undefined) {
		return undefined;
	}
	return String(value);
}

export function setSetting(key: string, raw: string): { previous?: string; value: string } {
	const def = requireDefinition(key);
	const parsed = parseSetting(def, raw);
	if (def.validate) {
		const result = def.validate(parsed);
		if (result !== true) {
			throw new Error(`Invalid value for '${key}': ${result}`);
		}
	}
	const value = String(parsed);
	const previous = configDatabase.get(key)?.value;
	configDatabase.set(key, value);
	const cache = refreshIfStale();
	cache.set(key, value);
	loadedAt = Date.now();
	return { previous, value };
}

export function unsetSetting(key: string): void {
	const def = requireDefinition(key);
	if (def.requiredWhen?.()) {
		throw new Error(
			`Setting '${key}' is required by the current service configuration and cannot be unset`
		);
	}
	configDatabase.unset(key);
	invalidateSettingsCache();
}

export function missingRequiredSettings(): SettingDefinition[] {
	const rows = new Map(configDatabase.getAll().map((row) => [row.key, row.value]));
	return registry.filter((def) => def.requiredWhen?.() && !rows.has(def.key));
}

export interface SettingsBatchError {
	key: string;
	error: string;
}

export function applySettingsBatch(entries: Record<string, string | null>): SettingsBatchError[] {
	const errors: SettingsBatchError[] = [];
	const normalized: Array<{ key: string; value: string | null }> = [];

	for (const [key, raw] of Object.entries(entries)) {
		const def = getDefinition(key);
		if (!def) {
			errors.push({ key, error: 'Unknown setting' });
			continue;
		}
		if (raw === null) {
			if (def.requiredWhen?.()) {
				errors.push({ key, error: 'Setting is required and cannot be unset' });
				continue;
			}
			normalized.push({ key, value: null });
			continue;
		}
		try {
			const parsed = parseSetting(def, raw);
			if (def.validate) {
				const result = def.validate(parsed);
				if (result !== true) {
					errors.push({ key, error: result });
					continue;
				}
			}
			normalized.push({ key, value: String(parsed) });
		} catch (error) {
			errors.push({ key, error: (error as Error).message });
		}
	}

	if (errors.length > 0) {
		return errors;
	}

	configDatabase.applyBatch(normalized);
	invalidateSettingsCache();
	return [];
}

export function describeSettings(): Array<{
	key: string;
	type: SettingDefinition['type'];
	description: string;
	default: string | null;
	value: string | null;
	set: boolean;
}> {
	const rows = new Map(configDatabase.getAll().map((row) => [row.key, row.value]));
	return registry.map((def) => ({
		key: def.key,
		type: def.type,
		description: def.description,
		default: def.default ?? null,
		value: rows.get(def.key) ?? def.default ?? null,
		set: rows.has(def.key)
	}));
}
