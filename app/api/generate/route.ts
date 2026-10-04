import { getGenerator } from '@/lib/generator';
import { preflight, streamingPostRoute } from '@/lib/http';
import { validateGenerate } from '@/lib/validate';

// A generation is a handful of Groq calls; allow up to 60s.
export const maxDuration = 60;

export const OPTIONS = preflight;

export const POST = streamingPostRoute(validateGenerate, (body, emit, signal) =>
	getGenerator().generate(body, { onProgress: emit, signal }),
);
