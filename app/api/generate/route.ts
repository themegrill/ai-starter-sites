import { getGenerator } from '@/lib/generator';
import { postRoute, preflight } from '@/lib/http';
import { validateGenerate } from '@/lib/validate';

// Groq + image lookups can take a while; allow up to 60s per generation.
export const maxDuration = 60;

export const OPTIONS = preflight;

export const POST = postRoute(validateGenerate, (body) => getGenerator().generate(body));
