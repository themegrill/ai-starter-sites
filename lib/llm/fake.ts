// Offline stand-in for the LLM (LLM=fake): fills every schema field with
// plausible filler so the full pipeline can run without an API key.
import { JsonSchema, LlmClient } from './types';

const fill = (schema: JsonSchema, key: string, prompt: string): unknown => {
	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
	if (Array.isArray(schema.enum)) return schema.enum.find((v) => prompt.toLowerCase().includes(String(v))) ?? schema.enum.at(-1);
	if (type === 'array') return ['sample one', 'sample two', 'sample three'];
	if (type === 'object') {
		const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
		return Object.fromEntries(Object.entries(props).map(([k, s]) => [k, fill(s, k, prompt)]));
	}
	// Copy slots: "k12 | h1 heading | 2-5 words" -> a value of the right length.
	const line = prompt.split('\n').find((l) => l.startsWith(`${key} |`));
	const words = Number(line?.match(/(\d+) words/)?.[1] ?? line?.match(/-(\d+) words/)?.[1] ?? 4);
	return Array.from({ length: Math.max(1, Math.min(words, 30)) }, (_, i) => (i ? 'text' : `Fake ${key}`)).join(' ');
};

export const fakeLlm: LlmClient = {
	model: 'fake',
	async json<T>(request: Parameters<LlmClient['json']>[0]) {
		await new Promise((r) => setTimeout(r, 150));
		return { data: fill(request.schema, '', request.user) as T, usage: { inputTokens: 0, outputTokens: 0, ms: 150 } };
	},
};
