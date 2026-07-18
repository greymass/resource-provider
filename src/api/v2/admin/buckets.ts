import { Elysia, t } from 'elysia';

import {
	adminAuthResponses,
	adminBucket,
	adminBucketBody,
	adminConflict,
	adminNameParams,
	adminNotFound,
	adminSuccess,
	adminUnprocessable
} from './types';

import { accessDatabase } from '$lib/db/models/provider/access';
import { policyDatabase } from '$lib/db/models/provider/policy';
import { usageDatabase } from '$lib/db/models/provider/usage';
import { invalidatePolicyCache } from '$lib/rules';

const tags = ['Admin'];

function bucketDocument(bucket: {
	name: string;
	priority: number;
	limit_ms: number;
	limit_kb: number;
}) {
	return { ...bucket, members: accessDatabase.count(bucket.name) };
}

export const adminBuckets = new Elysia({ prefix: '/buckets' })
	.get('/', () => policyDatabase.listBuckets().map(bucketDocument), {
		response: { 200: t.Array(adminBucket), ...adminAuthResponses },
		detail: { summary: 'List Buckets', tags }
	})
	.get(
		'/:name',
		({ params, set }) => {
			const bucket = policyDatabase.getBucket(params.name);
			if (!bucket) {
				set.status = 404;
				return { code: 404, message: `Unknown bucket '${params.name}'` };
			}
			return bucketDocument(bucket);
		},
		{
			params: adminNameParams,
			response: {
				200: adminBucket,
				404: adminNotFound,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Get Bucket', tags }
		}
	)
	.put(
		'/:name',
		({ params, body }) => {
			policyDatabase.putBucket(params.name, body.priority, body.limit_ms, body.limit_kb);
			invalidatePolicyCache();
			return { code: 200, message: `Bucket ${params.name} saved` };
		},
		{
			body: adminBucketBody,
			params: adminNameParams,
			response: { 200: adminSuccess, 422: adminUnprocessable, ...adminAuthResponses },
			detail: { summary: 'Create or Update Bucket', tags }
		}
	)
	.delete(
		'/:name',
		({ params, set }) => {
			if (!policyDatabase.getBucket(params.name)) {
				set.status = 404;
				return { code: 404, message: `Unknown bucket '${params.name}'` };
			}
			const refs = policyDatabase.rulesForBucket(params.name).map((rule) => rule.name);
			if (refs.length > 0) {
				set.status = 409;
				return {
					code: 409,
					message: `Bucket ${params.name} is referenced by rules: ${refs.join(', ')}`
				};
			}
			policyDatabase.removeBucket(params.name);
			const purged = usageDatabase.purgeBucket(params.name);
			const purgedMembers = accessDatabase.purgeBucket(params.name);
			invalidatePolicyCache();
			return {
				code: 200,
				message: `Removed bucket ${params.name}, purged ${purged} usage records and ${purgedMembers} access list members`
			};
		},
		{
			params: adminNameParams,
			response: {
				200: adminSuccess,
				404: adminNotFound,
				409: adminConflict,
				422: adminUnprocessable,
				...adminAuthResponses
			},
			detail: { summary: 'Delete Bucket', tags }
		}
	);
