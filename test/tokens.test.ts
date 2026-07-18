import { describe, expect, it, spyOn } from 'bun:test';

import { makeTokenCommand } from '../src/cli/token';

import { TOKEN_NAME_REGEX, tokensDatabase } from '$lib/db/models/provider/tokens';
import { generalLog } from '$lib/logger';

describe('tokensDatabase', () => {
	it('creates a token and returns the plaintext once', () => {
		const token = tokensDatabase.create('test-create', 'app');
		expect(token.startsWith('rp_')).toBeTrue();
		expect(token.length).toBeGreaterThan(20);
		const info = tokensDatabase.get('test-create');
		expect(info).toBeDefined();
		expect(info!.level).toBe('app');
		expect(info!.created_at).toBeGreaterThan(0);
		expect(info!.last_used_at).toBeNull();
		tokensDatabase.remove('test-create');
	});
	it('verifies a valid token and stamps last_used_at', () => {
		const token = tokensDatabase.create('test-verify', 'platform');
		const auth = tokensDatabase.verify(token);
		expect(auth).toEqual({ name: 'test-verify', level: 'platform' });
		expect(tokensDatabase.get('test-verify')!.last_used_at).toBeGreaterThan(0);
		tokensDatabase.remove('test-verify');
	});
	it('rejects unknown and revoked tokens', () => {
		expect(tokensDatabase.verify('rp_bogus')).toBeUndefined();
		const token = tokensDatabase.create('test-revoke', 'app');
		tokensDatabase.remove('test-revoke');
		expect(tokensDatabase.verify(token)).toBeUndefined();
	});
	it('rejects duplicate names', () => {
		tokensDatabase.create('test-dup', 'app');
		expect(() => tokensDatabase.create('test-dup', 'app')).toThrow();
		tokensDatabase.remove('test-dup');
	});
	it('classifies only a same-name uniqueness race as a token conflict', () => {
		tokensDatabase.create('test-race', 'app');
		const get = spyOn(tokensDatabase, 'get').mockReturnValue(undefined);
		try {
			expect(() => tokensDatabase.create('test-race', 'app')).toThrow();
			try {
				tokensDatabase.create('test-race', 'app');
			} catch (error) {
				expect((error as Error).name).toBe('TokenNameConflictError');
			}
		} finally {
			get.mockRestore();
			tokensDatabase.remove('test-race');
		}
	});
	it('rejects invalid slugs', () => {
		expect(() => tokensDatabase.create('Bad Name', 'app')).toThrow();
		expect(() => tokensDatabase.create('-leading', 'app')).toThrow();
		expect(() => tokensDatabase.create('', 'app')).toThrow();
		expect(TOKEN_NAME_REGEX.test('unicove-admin')).toBeTrue();
	});
	it('lists tokens without hashes', () => {
		tokensDatabase.create('test-list', 'app');
		const rows = tokensDatabase.list();
		const row = rows.find((r) => r.name === 'test-list');
		expect(row).toBeDefined();
		expect('hash' in row!).toBeFalse();
		tokensDatabase.remove('test-list');
	});
	it('generates distinct tokens', () => {
		const a = tokensDatabase.create('test-a', 'app');
		const b = tokensDatabase.create('test-b', 'app');
		expect(a).not.toBe(b);
		tokensDatabase.remove('test-a');
		tokensDatabase.remove('test-b');
	});
});

describe('token CLI', () => {
	it('emits the created token once through secret output and never through general logs', async () => {
		const secretOutput: string[] = [];
		const logged: string[] = [];
		const info = spyOn(generalLog, 'info').mockImplementation((message) => {
			logged.push(String(message));
			return generalLog;
		});

		try {
			await makeTokenCommand((token) => secretOutput.push(token)).parseAsync(
				['create', 'test-cli-secret'],
				{ from: 'user' }
			);
			expect(secretOutput).toHaveLength(1);
			expect(secretOutput[0]!.startsWith('rp_')).toBeTrue();
			expect(logged.some((message) => message.includes(secretOutput[0]!))).toBeFalse();

			logged.length = 0;
			await makeTokenCommand((token) => secretOutput.push(token)).parseAsync(['list'], {
				from: 'user'
			});
			expect(secretOutput).toHaveLength(1);
			expect(logged.some((message) => message.includes(secretOutput[0]!))).toBeFalse();
			expect(logged.some((message) => /\b[0-9a-f]{64}\b/i.test(message))).toBeFalse();
		} finally {
			info.mockRestore();
			tokensDatabase.remove('test-cli-secret');
		}
	});

	it('creates, lists, and removes via the command tree', async () => {
		const create = makeTokenCommand(() => undefined);
		await create.parseAsync(['create', 'test-cli', '--level', 'platform'], {
			from: 'user'
		});
		expect(tokensDatabase.get('test-cli')?.level).toBe('platform');
		const remove = makeTokenCommand();
		await remove.parseAsync(['remove', 'test-cli'], { from: 'user' });
		expect(tokensDatabase.get('test-cli')).toBeUndefined();
	});
	it('defaults level to app', async () => {
		await makeTokenCommand(() => undefined).parseAsync(['create', 'test-cli-app'], {
			from: 'user'
		});
		expect(tokensDatabase.get('test-cli-app')?.level).toBe('app');
		tokensDatabase.remove('test-cli-app');
	});
	it('rejects invalid levels without creating', async () => {
		await makeTokenCommand().parseAsync(['create', 'test-cli-bad', '--level', 'root'], {
			from: 'user'
		});
		expect(tokensDatabase.get('test-cli-bad')).toBeUndefined();
	});
});
