import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const FIXTURE_DIR = join(import.meta.dir, 'data');

interface Fixture {
	request: { url: string; body: unknown };
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

function getFixturePath(url: string, body: unknown): string {
	const hasher = new Bun.CryptoHasher('sha256');
	hasher.update(url + JSON.stringify(body));
	const hash = hasher.digest('hex').slice(0, 16);
	return join(FIXTURE_DIR, `${hash}.json`);
}

function parseBody(input: BodyInit | null | undefined): unknown {
	if (input == null) return null;
	if (typeof input === 'string') {
		try {
			return JSON.parse(input);
		} catch {
			return input;
		}
	}
	return String(input);
}

export function createMockFetch(originalFetch: typeof globalThis.fetch) {
	const mode = process.env.MOCK_RECORD;
	const recording = mode === 'true' || mode === 'overwrite';

	if (!existsSync(FIXTURE_DIR)) {
		mkdirSync(FIXTURE_DIR, { recursive: true });
	}

	return async function mockFetch(
		input: string | URL | Request,
		init?: RequestInit
	): Promise<Response> {
		const url =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const rawBody = init?.body ?? (input instanceof Request ? input.body : null);
		const body = parseBody(rawBody as BodyInit | null);
		const fixturePath = getFixturePath(url, body);

		if (!recording) {
			const file = Bun.file(fixturePath);
			if (!(await file.exists())) {
				throw new Error(
					`No fixture found: ${fixturePath}\nURL: ${url}\nBody: ${JSON.stringify(body)}`
				);
			}
			const fixture: Fixture = await file.json();
			return new Response(JSON.stringify(fixture.body), {
				status: fixture.status,
				headers: fixture.headers
			});
		}

		if (mode !== 'overwrite' && existsSync(fixturePath)) {
			const fixture: Fixture = await Bun.file(fixturePath).json();
			return new Response(JSON.stringify(fixture.body), {
				status: fixture.status,
				headers: fixture.headers
			});
		}

		const response = await originalFetch(input, init);
		const responseBody = await response.json();
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});

		const fixture: Fixture = {
			request: { url, body },
			status: response.status,
			headers,
			body: responseBody
		};

		await Bun.write(fixturePath, JSON.stringify(fixture, null, '\t'));

		return new Response(JSON.stringify(responseBody), {
			status: response.status,
			headers
		});
	};
}
