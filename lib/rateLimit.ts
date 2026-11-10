import { config } from './config';
import { ApiError } from './errors';

// Basic per-IP limit over a fixed one-minute window. Counts live in memory, so
// each serverless instance keeps its own and they reset on a cold start.
// Requests are proxied by the WordPress site, so the IP is the site's server.

const WINDOW_MS = 60_000;

const hits = new Map<string, { count: number; resetAt: number }>();

const clientIp = (request: Request) =>
	request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';

const prune = (now: number) => {
	for (const [ip, entry] of hits) {
		if (entry.resetAt <= now) hits.delete(ip);
	}
};

export const rateLimit = (request: Request) => {
	const limit = config.rateLimitPerMinute;
	if (!limit) {
		return;
	}

	const now = Date.now();
	if (hits.size > 10_000) prune(now);

	const ip = clientIp(request);
	const entry = hits.get(ip);
	if (!entry || entry.resetAt <= now) {
		hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return;
	}

	entry.count++;
	if (entry.count > limit) {
		const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
		throw new ApiError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', retryAfter);
	}
};
