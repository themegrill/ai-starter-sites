// Claude via the Anthropic SDK with structured outputs (output_config.format).
// Like Groq's strict mode, decoding is constrained to the schema, so the reply
// parses and has every required key; word limits are still checked by callers.
import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '../errors';
import { JsonRequest, LlmClient, LlmUsage } from './types';

const TIMEOUT_MS = 90_000;
// Thinking tokens count against max_tokens, so callers' budgets (sized for
// Groq's visible output only) get a floor. It is a cap, not a charge.
const MIN_MAX_TOKENS = 16_000;

export const createClaudeClient = (apiKey: string, model: string): LlmClient => {
	// The SDK retries 429/5xx and connection errors itself (honouring retry-after).
	const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

	const call = async <T>(request: JsonRequest): Promise<{ data: T; usage: LlmUsage }> => {
		const started = Date.now();

		let message: Anthropic.Beta.BetaMessage;
		try {
			message = await client.beta.messages.create(
				{
					model,
					max_tokens: Math.max(request.maxTokens ?? 4096, MIN_MAX_TOKENS),
					system: request.system,
					messages: [{ role: 'user', content: request.user }],
					output_config: {
						format: { type: 'json_schema', schema: request.schema },
						// Copywriting needs little deliberation; low effort keeps it fast and cheap.
						effort: 'low',
					},
					// A safety decline is re-run on Anthropic's recommended fallback model.
					// Haiku has no server-side fallback (a fallback list is a 400).
					...(model.startsWith('claude-haiku')
						? {}
						: { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
				},
				{ signal: request.signal },
			);
		} catch (error) {
			if (request.signal?.aborted) throw error;
			if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
				throw new ApiError('GENERATION_FAILED', 'The AI service is busy right now. Please try again in a minute.', 60);
			}
			if (error instanceof Anthropic.APIError && error.status) {
				console.error(`[claude] ${request.name} ${error.status}:`, error.message);
				throw new ApiError('GENERATION_FAILED', 'The AI service rejected the request.');
			}
			throw new ApiError('GENERATION_FAILED', 'The AI service did not respond in time. Please try again.');
		}

		if (message.stop_reason === 'refusal') {
			console.warn(`[claude] ${request.name} refused:`, message.stop_details?.category);
			throw new ApiError('GENERATION_FAILED', 'The AI service declined this request.');
		}
		const text = message.content.find((block) => block.type === 'text')?.text;
		if (!text || message.stop_reason === 'max_tokens') {
			throw new ApiError('INVALID_RESPONSE', 'The AI service returned an incomplete response.');
		}

		let data: T;
		try {
			data = JSON.parse(text) as T;
		} catch {
			throw new ApiError('INVALID_RESPONSE', 'The AI service returned an unexpected response.');
		}

		return {
			data,
			usage: {
				inputTokens: message.usage.input_tokens,
				outputTokens: message.usage.output_tokens,
				ms: Date.now() - started,
			},
		};
	};

	// Sampling parameters (request.temperature) are rejected by current Claude models, so they are dropped.
	return { model, json: (request) => call(request) };
};
