import { Base58, Bytes } from '@wharfkit/antelope';
import { eq } from 'drizzle-orm';

import { database } from '$lib/db';
import { AbstractDatabase } from '$lib/db/abstract';

export type TokenLevel = 'platform' | 'app';

export interface TokenInfo {
	name: string;
	level: TokenLevel;
	created_at: number;
	last_used_at: number | null;
}

export const TOKEN_NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class TokenNameConflictError extends Error {
	readonly tokenName: string;

	constructor(tokenName: string) {
		super(`Token '${tokenName}' already exists. Revoke it first to rotate.`);
		this.name = 'TokenNameConflictError';
		this.tokenName = tokenName;
	}
}

function isTokenNameUniquenessError(error: unknown): boolean {
	return (
		error instanceof Error &&
		'code' in error &&
		String((error as Error & { code: unknown }).code).startsWith('SQLITE_CONSTRAINT') &&
		error.message.includes('UNIQUE constraint failed: tokens.name')
	);
}

function hashToken(token: string): string {
	return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

export class TokensDatabase extends AbstractDatabase {
	create(name: string, level: TokenLevel): string {
		if (!TOKEN_NAME_REGEX.test(name)) {
			throw new Error(`Invalid token name '${name}'. Expected a slug like 'unicove-admin'.`);
		}
		const bytes = crypto.getRandomValues(new Uint8Array(32));
		const token = `rp_${Base58.encode(Bytes.from(bytes))}`;
		try {
			database
				.insert(this.schema.tokens)
				.values({
					name,
					hash: hashToken(token),
					level,
					created_at: Math.floor(Date.now() / 1000)
				})
				.run();
		} catch (error) {
			if (isTokenNameUniquenessError(error)) {
				throw new TokenNameConflictError(name);
			}
			throw error;
		}
		return token;
	}

	list(): TokenInfo[] {
		return database
			.select({
				name: this.schema.tokens.name,
				level: this.schema.tokens.level,
				created_at: this.schema.tokens.created_at,
				last_used_at: this.schema.tokens.last_used_at
			})
			.from(this.schema.tokens)
			.all() as TokenInfo[];
	}

	get(name: string): TokenInfo | undefined {
		return this.list().find((row) => row.name === name);
	}

	remove(name: string): void {
		database.delete(this.schema.tokens).where(eq(this.schema.tokens.name, name)).run();
	}

	verify(token: string): { name: string; level: TokenLevel } | undefined {
		const row = database
			.select()
			.from(this.schema.tokens)
			.where(eq(this.schema.tokens.hash, hashToken(token)))
			.get();
		if (!row) {
			return undefined;
		}
		database
			.update(this.schema.tokens)
			.set({ last_used_at: Math.floor(Date.now() / 1000) })
			.where(eq(this.schema.tokens.name, row.name))
			.run();
		return { name: row.name, level: row.level as TokenLevel };
	}
}

export const tokensDatabase = new TokensDatabase();
