export interface RamManagerConfig {
	url?: string;
	token?: string;
	chainId?: string;
}
const jungle4 = '73e4385a2708e6d7048834fbc1079f2fabb17b3c125b146af438971e90716c4d';
export async function ensureSponsoredRam(
	account: string,
	requestId: string,
	config: RamManagerConfig,
	requiredQuotaBytes?: number
): Promise<boolean> {
	if (!config.url && !config.token) return false;
	if (!config.url || !config.token || config.token.length < 32 || config.chainId !== jungle4) {
		throw new Error('Gifted capacity is not configured for this chain.');
	}
	const url = new URL(config.url);
	const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
	if (
		(!local && url.protocol !== 'https:') ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	)
		throw new Error('Invalid capacity service origin.');
	const response = await fetch(new URL('/v1/ensure', url), {
		method: 'POST',
		redirect: 'error',
		headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ account, requestId, requiredQuotaBytes }),
		signal: AbortSignal.timeout(20000)
	});
	if (!response.ok) throw new Error('Sponsored capacity is temporarily unavailable.');
	const result = (await response.json()) as { status?: string };
	if (result.status === 'ineligible') return false;
	if (result.status === 'gifted' || result.status === 'sufficient') return true;
	throw new Error('Sponsored capacity is pending operator review.');
}
