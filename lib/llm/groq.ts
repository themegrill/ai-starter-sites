// Groq's OpenAI-compatible chat completions with strict JSON-schema output.
// Strict mode uses constrained decoding, so the reply always parses and has
// every required key; value-level rules (word limits) are checked by callers.
import { ApiError } from '../errors';
import { JsonRequest, LlmClient, LlmUsage } from './types';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 45_000;

type GroqResponse = {
	choices?: { message?: { content?: string }; finish_reason?: string }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number };
	error?: { message?: string; code?: string };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const createGroqClient = (apiKey: string, model: string): LlmClient => {
	const call = async <T>(request: JsonRequest, attempt: number): Promise<{ data: T; usage: LlmUsage }> => {
		const started = Date.now();
		const signals = [AbortSignal.timeout(TIMEOUT_MS), ...(request.signal ? [request.signal] : [])];

		let response: Response;
		try {
			response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model,
					messages: [
						{ role: 'system', content: request.system },
						{ role: 'user', content: request.user },
					],
					response_format: {
						type: 'json_schema',
						json_schema: { name: request.name, strict: true, schema: request.schema },
					},
					temperature: request.temperature ?? 0.7,
					max_completion_tokens: request.maxTokens ?? 4096,
					// Copywriting needs little deliberation; low effort keeps it fast and cheap.
					reasoning_effort: 'low',
					include_reasoning: false,
				}),
				signal: AbortSignal.any(signals),
			});
		} catch (error) {
			if (request.signal?.aborted) throw error;
			if (attempt === 0) return call(request, 1);
			throw new ApiError('GENERATION_FAILED', 'The AI service did not respond in time. Please try again.');
		}

		const body = (await response.json().catch(() => ({}))) as GroqResponse;

		// Provider rate limits and outages: one retry, then give up. Token limits
		// reset within a minute, so waiting up to 30s usually gets through.
		if (response.status === 429 || response.status >= 500) {
			if (attempt === 0) {
				const wait = Number(response.headers.get('retry-after')) || 2;
				console.warn(`[groq] ${request.name} ${response.status}, retrying in ${Math.min(wait, 30)}s`);
				await sleep(Math.min(wait, 30) * 1000);
				return call(request, 1);
			}
			throw new ApiError('GENERATION_FAILED', 'The AI service is busy right now. Please try again in a minute.', 60);
		}
		// A reply cut off by the token budget fails schema validation: retry with more room.
		if (body.error?.code === 'json_validate_failed' && attempt === 0) {
			console.warn(`[groq] ${request.name} invalid JSON (likely truncated), retrying with a larger budget`);
			return call({ ...request, maxTokens: Math.min((request.maxTokens ?? 4096) * 2, 12000) }, 1);
		}
		if (!response.ok) {
			console.error(`[groq] ${request.name} ${response.status}:`, body.error?.message);
			throw new ApiError('GENERATION_FAILED', 'The AI service rejected the request.');
		}

		const choice = body.choices?.[0];
		const content = choice?.message?.content;
		if (!content || choice?.finish_reason === 'length') {
			if (attempt === 0) return call({ ...request, maxTokens: (request.maxTokens ?? 4096) * 2 }, 1);
			throw new ApiError('INVALID_RESPONSE', 'The AI service returned an incomplete response.');
		}

		let data: T;
		try {
			data = JSON.parse(content) as T;
		} catch {
			throw new ApiError('INVALID_RESPONSE', 'The AI service returned an unexpected response.');
		}

		return {
			data,
			usage: {
				inputTokens: body.usage?.prompt_tokens ?? 0,
				outputTokens: body.usage?.completion_tokens ?? 0,
				ms: Date.now() - started,
			},
		};
	};

	return { model, json: (request) => call(request, 0) };
};
