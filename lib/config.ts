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
		return !process.env.GROQ_API_KEY;
	},
	get mockDelayMs() {
		const ms = Number(process.env.MOCK_DELAY_MS ?? 1500);
		return Number.isFinite(ms) && ms >= 0 ? ms : 1500;
	},
	get siteTokens() {
		return list(process.env.SITE_TOKENS);
	},
	get allowedOrigins() {
		const origins = list(process.env.ALLOWED_ORIGINS);
		return origins.length ? origins : ['*'];
	},
	get groqModel() {
		return process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
	},
};
