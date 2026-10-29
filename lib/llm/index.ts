import { config } from '../config';
import { ApiError } from '../errors';
import { createClaudeClient } from './claude';
import { fakeLlm } from './fake';
import { createGroqClient } from './groq';
import { LlmClient } from './types';

let client: LlmClient | undefined;

export const getLlm = (): LlmClient => {
	if (process.env.LLM === 'fake') return fakeLlm;
	if (config.llm === 'claude') {
		const apiKey = process.env.ANTHROPIC_API_KEY;
		if (!apiKey) throw new ApiError('GENERATION_FAILED', 'ANTHROPIC_API_KEY is not set on the server.');
		client ??= createClaudeClient(apiKey, config.claudeModel);
		return client;
	}
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) {
		throw new ApiError('GENERATION_FAILED', 'GROQ_API_KEY is not set on the server.');
	}
	client ??= createGroqClient(apiKey, config.groqModel);
	return client;
};

export type { JsonSchema, LlmClient, LlmUsage } from './types';
