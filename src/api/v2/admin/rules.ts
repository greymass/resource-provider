import { Elysia, t } from 'elysia';

import {
	adminAuthResponses,
	adminNameParams,
	adminNotFound,
	adminRule,
	adminRuleBody,
	adminSuccess,
	adminUnprocessable
} from './types';

import { policyDatabase } from '$lib/db/models/provider/policy';
import { invalidatePolicyCache, validatePattern } from '$lib/rules';

const tags = ['Admin'];

function ruleDocument(name: string) {
	const rule = policyDatabase.getRule(name);
	if (!rule) {
		return undefined;
	}
	const patterns = policyDatabase.listPatterns(name);
	return {
		name: rule.name,
		bucket: rule.bucket,
		allow: patterns.filter((p) => p.kind === 'allow').map((p) => p.pattern),
		require: patterns.filter((p) => p.kind === 'require').map((p) => p.pattern)
	};
}

export const adminRules = new Elysia({ prefix: '/rules' })
	.get('/', () => policyDatabase.listRules().map((r) => ruleDocument(r.name)!), {
		response: { 200: t.Array(adminRule), ...adminAuthResponses },
		detail: { summary: 'List Rules', tags }
	})
	.get(
		'/:name',
		({ params, set }) => {
			const doc = ruleDocument(params.name);
			if (!doc) {
				set.status = 404;
				return { code: 404, message: `Unknown rule '${params.name}'` };
			}
			return doc;
		},
		{
			params: adminNameParams,
			response: {
				200: adminRule,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Get Rule', tags }
		}
	)
	.put(
		'/:name',
		({ params, body, set }) => {
			if (!policyDatabase.getBucket(body.bucket)) {
				set.status = 422;
				return { code: 422, message: `Unknown bucket '${body.bucket}'` };
			}
			const errors: string[] = [];
			for (const pattern of [...body.allow, ...body.require]) {
				try {
					validatePattern(pattern);
				} catch (error) {
					errors.push(String(error));
				}
			}
			if (errors.length > 0) {
				set.status = 422;
				return { code: 422, message: `Invalid patterns: ${errors.join('; ')}` };
			}
			policyDatabase.putRuleDocument(params.name, body.bucket, body.allow, body.require);
			invalidatePolicyCache();
			return ruleDocument(params.name)!;
		},
		{
			body: adminRuleBody,
			params: adminNameParams,
			response: { 200: adminRule, 422: adminUnprocessable, ...adminAuthResponses },
			detail: { summary: 'Create or Update Rule', tags }
		}
	)
	.delete(
		'/:name',
		({ params, set }) => {
			if (!policyDatabase.getRule(params.name)) {
				set.status = 404;
				return { code: 404, message: `Unknown rule '${params.name}'` };
			}
			policyDatabase.removeRule(params.name);
			invalidatePolicyCache();
			return { code: 200, message: `Removed rule ${params.name}` };
		},
		{
			params: adminNameParams,
			response: {
				200: adminSuccess,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Delete Rule', tags }
		}
	);
