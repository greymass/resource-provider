import { describe, expect, it } from 'bun:test';

import { describeSetting } from '../src/cli/config';

import { configDatabase } from '$lib/db/models/config';
import {
	applySettingsBatch,
	describeSettings,
	getBool,
	getInt,
	getSetting,
	getString,
	invalidateSettingsCache,
	missingRequiredSettings,
	setSetting,
	unsetSetting
} from '$lib/settings';
import {
	getDefinition,
	getDefinition as getDef,
	parseSetting,
	registry
} from '$lib/settings/registry';
import { RETIRED_ENV_VARS } from '$lib/settings/retired';

describe('configDatabase', () => {
	it('returns undefined for a missing key', () => {
		expect(configDatabase.get('nonexistent.key')).toBeUndefined();
	});
	it('sets and gets a value', () => {
		configDatabase.set('test.key', '42');
		const row = configDatabase.get('test.key');
		expect(row?.value).toBe('42');
		expect(row?.scope).toBe('global');
		expect(row?.updated_at).toBeGreaterThan(0);
	});
	it('upserts on repeated set', () => {
		configDatabase.set('test.key', '42');
		configDatabase.set('test.key', '43');
		expect(configDatabase.get('test.key')?.value).toBe('43');
		expect(configDatabase.getAll().filter((r) => r.key === 'test.key').length).toBe(1);
	});
	it('unsets a value', () => {
		configDatabase.set('test.gone', '1');
		configDatabase.unset('test.gone');
		expect(configDatabase.get('test.gone')).toBeUndefined();
	});
	it('scopes are isolated', () => {
		configDatabase.set('test.scoped', 'g');
		configDatabase.set('test.scoped', 'c', 'contract:example');
		expect(configDatabase.get('test.scoped')?.value).toBe('g');
		expect(configDatabase.get('test.scoped', 'contract:example')?.value).toBe('c');
	});
	it('rolls back a batch when a later database write fails', () => {
		const firstKey = 'test.atomic-first';
		configDatabase.unset(firstKey);
		try {
			expect(() =>
				configDatabase.applyBatch([
					{ key: firstKey, value: 'written-before-failure' },
					{ key: null as unknown as string, value: 'invalid' }
				])
			).toThrow();
			expect(configDatabase.get(firstKey)).toBeUndefined();
		} finally {
			configDatabase.unset(firstKey);
		}
	});
});

describe('settings registry', () => {
	it('defines the free powerup amount as conditionally required', () => {
		const def = getDefinition('provider.free_powerup.ms');
		expect(def).toBeDefined();
		expect(def!.type).toBe('integer');
		expect(typeof def!.requiredWhen).toBe('function');
	});
	it('returns undefined for unknown keys', () => {
		expect(getDefinition('provider.unknown')).toBeUndefined();
	});
	it('parses integers and rejects non-integers', () => {
		const def = getDefinition('provider.usage.window_hours')!;
		expect(parseSetting(def, '24')).toBe(24);
		expect(() => parseSetting(def, 'abc')).toThrow();
		expect(() => parseSetting(def, '1.5')).toThrow();
	});
	it('parses booleans strictly', () => {
		const def = getDefinition('provider.require_resource_need')!;
		expect(parseSetting(def, 'true')).toBeTrue();
		expect(parseSetting(def, 'false')).toBeFalse();
		expect(() => parseSetting(def, 'yes')).toThrow();
	});
	it('parses and canonicalizes assets', () => {
		const def = getDefinition('provider.paid_transactions.minimum_fee')!;
		expect(parseSetting(def, '0.0001 A')).toBe('0.0001 A');
		expect(() => parseSetting(def, 'not-an-asset')).toThrow();
	});
	it('every registry key has a type and description', () => {
		for (const def of registry) {
			expect(def.key.startsWith('provider.')).toBeTrue();
			expect(def.description.length).toBeGreaterThan(0);
		}
	});
});

describe('settings module', () => {
	it('falls back to registry defaults', () => {
		invalidateSettingsCache();
		expect(getInt('provider.usage.window_hours')).toBe(24);
		expect(getBool('provider.require_resource_need')).toBeTrue();
		expect(getString('provider.paid_transactions.fee_recipient')).toBeUndefined();
	});
	it('round-trips set and get', () => {
		setSetting('provider.min_cpu_us', '60000');
		expect(getInt('provider.min_cpu_us')).toBe(60000);
		unsetSetting('provider.min_cpu_us');
		expect(getInt('provider.min_cpu_us')).toBe(50000);
	});
	it('reports previous value on set', () => {
		setSetting('provider.min_net_bytes', '70000');
		const result = setSetting('provider.min_net_bytes', '80000');
		expect(result.previous).toBe('70000');
		expect(result.value).toBe('80000');
		unsetSetting('provider.min_net_bytes');
	});
	it('rejects unknown keys', () => {
		expect(() => setSetting('provider.bogus', '1')).toThrow();
		expect(() => getSetting('provider.bogus')).toThrow();
	});
	it('rejects invalid values without writing', () => {
		expect(() => setSetting('provider.usage.window_hours', '-5')).toThrow();
		expect(() => setSetting('provider.usage.window_hours', 'abc')).toThrow();
		expect(getInt('provider.usage.window_hours')).toBe(24);
	});
	it('allows unsetting a key that is not currently required', () => {
		expect(() => unsetSetting('provider.free_powerup.ms')).not.toThrow();
	});
	it('reports no missing required settings when defaults and disabled features cover the registry', () => {
		expect(missingRequiredSettings()).toEqual([]);
	});
	it('serves stale values until the cache is invalidated', () => {
		setSetting('provider.min_cpu_us', '55000');
		configDatabase.set('provider.min_cpu_us', '99999');
		expect(getInt('provider.min_cpu_us')).toBe(55000);
		invalidateSettingsCache();
		expect(getInt('provider.min_cpu_us')).toBe(99999);
		unsetSetting('provider.min_cpu_us');
	});
});

describe('config CLI helpers', () => {
	it('marks unset required keys', () => {
		configDatabase.unset('provider.free_powerup.ms');
		const line = describeSetting(getDef('provider.free_powerup.ms')!);
		expect(line).toContain('provider.free_powerup.ms');
		expect(line).toContain('<unset>');
	});
	it('marks default values', () => {
		configDatabase.unset('provider.usage.window_hours');
		const line = describeSetting(getDef('provider.usage.window_hours')!);
		expect(line).toContain('24 (default)');
	});
	it('shows set values without a marker', () => {
		configDatabase.set('provider.usage.window_hours', '48');
		const line = describeSetting(getDef('provider.usage.window_hours')!);
		expect(line).toContain('48');
		expect(line).not.toContain('(default)');
		configDatabase.unset('provider.usage.window_hours');
	});
});

describe('retired env vars', () => {
	it('covers every migrated knob', () => {
		expect(RETIRED_ENV_VARS).toContain('PROVIDER_FREE_TRANSACTIONS_LIMIT_MS');
		expect(RETIRED_ENV_VARS).toContain('PROVIDER_USAGE_WINDOW_HOURS');
		expect(RETIRED_ENV_VARS).toContain('PROVIDER_FREE_POWERUP_MAX_PAYMENT');
		expect(RETIRED_ENV_VARS.length).toBe(14);
	});
});

describe('settings batch', () => {
	it('applies a valid batch atomically', () => {
		try {
			const errors = applySettingsBatch({
				'provider.min_cpu_us': '61000',
				'provider.min_net_bytes': '62000'
			});
			expect(errors).toEqual([]);
			expect(getInt('provider.min_cpu_us')).toBe(61000);
			expect(getInt('provider.min_net_bytes')).toBe(62000);
		} finally {
			expect(
				applySettingsBatch({ 'provider.min_cpu_us': null, 'provider.min_net_bytes': null })
			).toEqual([]);
		}
	});
	it('applies nothing when any entry is invalid', () => {
		const errors = applySettingsBatch({
			'provider.min_cpu_us': '63000',
			'provider.bogus': '1',
			'provider.usage.window_hours': '-5'
		});
		expect(errors.length).toBe(2);
		expect(errors.map((e) => e.key).sort()).toEqual([
			'provider.bogus',
			'provider.usage.window_hours'
		]);
		expect(getInt('provider.min_cpu_us')).toBe(50000);
	});
	it('unsets via null', () => {
		try {
			expect(applySettingsBatch({ 'provider.min_cpu_us': '64000' })).toEqual([]);
			const errors = applySettingsBatch({ 'provider.min_cpu_us': null });
			expect(errors).toEqual([]);
			expect(getInt('provider.min_cpu_us')).toBe(50000);
		} finally {
			expect(applySettingsBatch({ 'provider.min_cpu_us': null })).toEqual([]);
		}
	});
	it('describes the full registry with values and set flags', () => {
		const rows = describeSettings();
		expect(rows.length).toBe(registry.length);
		const window = rows.find((r) => r.key === 'provider.usage.window_hours')!;
		expect(window.value).toBe('24');
		expect(window.set).toBeFalse();
	});
});
