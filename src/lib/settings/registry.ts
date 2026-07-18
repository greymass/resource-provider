import { Asset } from '@wharfkit/antelope';

import { ANTELOPE_SYSTEM_TOKEN, ENABLE_FREE_POWERUP } from 'src/config';

export type SettingValue = number | boolean | string;

export interface SettingDefinition {
	key: string;
	type: 'integer' | 'boolean' | 'string' | 'asset';
	description: string;
	default?: string;
	requiredWhen?: () => boolean;
	validate?: (value: SettingValue) => true | string;
}

const systemSymbol = (ANTELOPE_SYSTEM_TOKEN || '4,TOKEN').split(',')[1];

const positive = (value: SettingValue) => (Number(value) > 0 ? true : 'must be greater than 0');

export const registry: SettingDefinition[] = [
	{
		key: 'provider.usage.window_hours',
		type: 'integer',
		description:
			'Rolling usage window (hours); shrinking forgives usage instantly, growing only re-counts rows not yet cleaned up',
		default: '24',
		validate: positive
	},
	{
		key: 'provider.require_resource_need',
		type: 'boolean',
		description: 'Reject requests from accounts that already have sufficient resources',
		default: 'true'
	},
	{
		key: 'provider.min_cpu_us',
		type: 'integer',
		description: 'CPU threshold (microseconds) below which an account is considered in need',
		default: '50000',
		validate: positive
	},
	{
		key: 'provider.min_net_bytes',
		type: 'integer',
		description: 'NET threshold (bytes) below which an account is considered in need',
		default: '50000',
		validate: positive
	},
	{
		key: 'provider.paid_transactions.minimum_fee',
		type: 'asset',
		description: 'Minimum fee charged for paid transactions',
		default: `0.0001 ${systemSymbol}`
	},
	{
		key: 'provider.paid_transactions.fee_recipient',
		type: 'string',
		description: 'Account receiving transaction fees (defaults to the cosigner account when unset)'
	},
	{
		key: 'provider.paid_transactions.fee_memo',
		type: 'string',
		description: 'Memo attached to fee transfer actions',
		default: 'Fuel Transaction Fee'
	},
	{
		key: 'provider.paid_transactions.fee_default_ref',
		type: 'string',
		description: 'Default referrer tag appended to fee memos',
		default: 'teamgreymass'
	},
	{
		key: 'provider.free_powerup.ms',
		type: 'integer',
		description: 'Free powerup CPU amount (milliseconds)',
		requiredWhen: () => ENABLE_FREE_POWERUP,
		validate: positive
	},
	{
		key: 'provider.free_powerup.kb',
		type: 'integer',
		description: 'Free powerup NET amount (kilobytes)',
		requiredWhen: () => ENABLE_FREE_POWERUP,
		validate: positive
	},
	{
		key: 'provider.free_powerup.uses',
		type: 'integer',
		description: 'Maximum free powerup uses per account per day',
		requiredWhen: () => ENABLE_FREE_POWERUP,
		validate: positive
	},
	{
		key: 'provider.free_powerup.max_payment',
		type: 'asset',
		description: 'Maximum cost the provider will cover for a free powerup',
		requiredWhen: () => ENABLE_FREE_POWERUP
	}
];

export function getDefinition(key: string): SettingDefinition | undefined {
	return registry.find((def) => def.key === key);
}

export function parseSetting(def: SettingDefinition, raw: string): SettingValue {
	switch (def.type) {
		case 'integer': {
			const value = Number(raw);
			if (!Number.isInteger(value)) {
				throw new Error(`Setting '${def.key}' expects an integer, got '${raw}'`);
			}
			return value;
		}
		case 'boolean': {
			if (raw !== 'true' && raw !== 'false') {
				throw new Error(`Setting '${def.key}' expects 'true' or 'false', got '${raw}'`);
			}
			return raw === 'true';
		}
		case 'asset': {
			try {
				return String(Asset.from(raw));
			} catch {
				throw new Error(
					`Setting '${def.key}' expects an asset (e.g. '0.0001 ${systemSymbol}'), got '${raw}'`
				);
			}
		}
		case 'string':
			return raw;
	}
}
