// Provider-neutral LLM interface. The pipeline only asks for JSON matching a
// schema, so swapping Groq for another OpenAI-compatible provider (or a
// bigger model) means writing one more implementation of this.

export type JsonSchema = Record<string, unknown>;

export type JsonRequest = {
	name: string; // Schema name, also used in logs.
	system: string;
	user: string;
	schema: JsonSchema;
	maxTokens?: number;
	temperature?: number;
	signal?: AbortSignal;
};

export type LlmUsage = { inputTokens: number; outputTokens: number; ms: number };

export interface LlmClient {
	readonly model: string;
	json<T>(request: JsonRequest): Promise<{ data: T; usage: LlmUsage }>;
}
