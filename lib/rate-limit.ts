// Fixed-window rate limits, per client IP, plus a global daily cap on the
// routes that call the LLM. Backed by Upstash Redis (REST, no extra package)
// when its env vars are set; otherwise an in-memory fallback that only covers
// one warm serverless instance, so production should always set Upstash.
import { config } from './config';
import { ApiError } from './errors';

export type LimitName = 'ai' | 'regenerate' | 'light';

type Rule = { limit: number; windowMs: number };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const rules = (): Record<LimitName, Rule> => ({
	ai: { limit: config.rateLimits.aiPerHour, windowMs: HOUR },
	regenerate: { limit: config.rateLimits.regeneratePerHour, windowMs: HOUR },
	light: { limit: config.rateLimits.lightPerHour, windowMs: HOUR },
});

// Routes in these buckets spend LLM tokens and count toward the daily cap.
const COSTLY: LimitName[] = ['ai', 'regenerate'];

const memory = new Map<string, { count: number; expiresAt: number }>();

const incrMemory = (key: string, windowMs: number) => {
	const now = Date.now();
	if (memory.size > 10_000) {
		for (const [k, v] of memory) if (v.expiresAt <= now) memory.delete(k);
	}
	const entry = memory.get(key);
	if (!entry || entry.expiresAt <= now) {
		memory.set(key, { count: 1, expiresAt: now + windowMs });
		return 1;
	}
	entry.count += 1;
	return entry.count;
};

const incrUpstash = async (key: string, windowMs: number) => {
	const { url, token } = config.upstash;
	const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify([
			['INCR', key],
			['PEXPIRE', key, String(windowMs), 'NX'],
		]),
		cache: 'no-store',
	});
	if (!response.ok) throw new Error(`Upstash responded ${response.status}`);
	const [incr] = (await response.json()) as { result?: number; error?: string }[];
	if (typeof incr?.result !== 'number') throw new Error(`Upstash error: ${incr?.error ?? 'bad response'}`);
	return incr.result;
};

const incr = async (key: string, windowMs: number) => {
	if (config.upstash.url && config.upstash.token) {
		try {
			return await incrUpstash(key, windowMs);
		} catch (error) {
			// Don't take the API down with Redis; fall back to this instance's memory.
			console.error('Rate limit store unavailable, using in-memory fallback.', error);
		}
	}
	return incrMemory(key, windowMs);
};

export const clientIp = (request: Request) =>
	request.headers.get('x-real-ip')?.trim() ||
	request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
	'unknown';

const check = async (key: string, rule: Rule, message: string) => {
	if (rule.limit <= 0) return; // 0 disables a limit.
	const windowStart = Math.floor(Date.now() / rule.windowMs) * rule.windowMs;
	const count = await incr(`rl:${key}:${windowStart}`, rule.windowMs);
	if (count > rule.limit) {
		const retryAfter = Math.max(1, Math.ceil((windowStart + rule.windowMs - Date.now()) / 1000));
		throw new ApiError('RATE_LIMITED', message, retryAfter);
	}
};

export const enforceRateLimit = async (request: Request, name: LimitName) => {
	await check(`${name}:${clientIp(request)}`, rules()[name], 'Too many requests. Please wait a little and try again.');
	if (COSTLY.includes(name)) {
		await check(
			'global:daily',
			{ limit: config.rateLimits.dailyCap, windowMs: DAY },
			'AI generation is busy right now. Please try again later.',
		);
	}
};
