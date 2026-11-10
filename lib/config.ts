// Server-side config read from environment variables. See .env.example.

const list = (value: string | undefined) =>
	(value ?? '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);

export const config = {
	get mock() {
		const flag = process.env.MOCK?.toLowerCase();
		if (flag === 'true') return true;
		if (flag === 'false') return false;
		return !process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY && process.env.LLM !== 'fake';
	},
	get mockDelayMs() {
		const ms = Number(process.env.MOCK_DELAY_MS ?? 1500);
		return Number.isFinite(ms) && ms >= 0 ? ms : 1500;
	},
	get siteTokens() {
		return list(process.env.SITE_TOKENS);
	},
	// On the production deployment an empty SITE_TOKENS rejects every request
	// instead of letting everyone in. ALLOW_ANONYMOUS=true opts out on purpose.
	get requireSiteToken() {
		return process.env.VERCEL_ENV === 'production' && process.env.ALLOW_ANONYMOUS?.toLowerCase() !== 'true';
	},
	get rateLimits() {
		const num = (value: string | undefined, fallback: number) => {
			const n = Number(value);
			return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
		};
		return {
			// Per client IP, per hour. 0 disables that limit.
			aiPerHour: num(process.env.RATE_LIMIT_AI_PER_HOUR, 15),
			regeneratePerHour: num(process.env.RATE_LIMIT_REGENERATE_PER_HOUR, 60),
			lightPerHour: num(process.env.RATE_LIMIT_LIGHT_PER_HOUR, 600),
			// Across everyone, per UTC day, for routes that call the LLM.
			dailyCap: num(process.env.AI_DAILY_CAP, 3000),
		};
	},
	// Upstash Redis REST credentials; the Vercel Upstash integration sets the KV_* names.
	get upstash() {
		return {
			url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
			token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
		};
	},
	// Largest accepted JSON body, in bytes. The preview route sends whole pages.
	get maxBodyBytes() {
		const n = Number(process.env.MAX_BODY_BYTES);
		return Number.isFinite(n) && n > 0 ? n : 512 * 1024;
	},
	get allowedOrigins() {
		const origins = list(process.env.ALLOWED_ORIGINS);
		return origins.length ? origins : ['*'];
	},
	get pixabayApiKey() {
		return process.env.PIXABAY_API_KEY || '';
	},
	// LLM_PROVIDER: 1 = Groq, 2 = Claude. Unset picks Groq when its key is set, else Claude.
	get llm(): 'groq' | 'claude' {
		const provider = process.env.LLM_PROVIDER?.trim();
		if (provider === '1') return 'groq';
		if (provider === '2') return 'claude';
		return process.env.GROQ_API_KEY || !process.env.ANTHROPIC_API_KEY ? 'groq' : 'claude';
	},
	get model() {
		return this.llm === 'claude' ? this.claudeModel : this.groqModel;
	},
	get claudeModel() {
		return process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
	},
	get groqModel() {
		return process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
	},
};
