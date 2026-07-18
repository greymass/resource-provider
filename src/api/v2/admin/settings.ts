import { Elysia, t } from 'elysia';

import {
	adminAuthResponses,
	adminSetting,
	adminSettingsBody,
	adminSettingsInvalid,
	adminSuccess,
	adminUnprocessable
} from './types';

import { applySettingsBatch, describeSettings } from '$lib/settings';

const tags = ['Admin'];

export const adminSettings = new Elysia({ prefix: '/settings' })
	.get('/', () => describeSettings(), {
		response: { 200: t.Array(adminSetting), ...adminAuthResponses },
		detail: { summary: 'List Settings', tags }
	})
	.put(
		'/',
		({ body, set }) => {
			const errors = applySettingsBatch(body);
			if (errors.length > 0) {
				set.status = 422;
				return { code: 422, message: 'Invalid settings', errors };
			}
			return { code: 200, message: 'Settings updated' };
		},
		{
			body: adminSettingsBody,
			response: {
				200: adminSuccess,
				422: t.Union([adminUnprocessable, adminSettingsInvalid]),
				...adminAuthResponses
			},
			detail: { summary: 'Update Settings (atomic batch, null unsets)', tags }
		}
	);
