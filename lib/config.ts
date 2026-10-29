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
