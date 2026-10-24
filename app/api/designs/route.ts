import { getGenerator } from '@/lib/generator';
import { postRoute, preflight } from '@/lib/http';
import { validateGenerate } from '@/lib/validate';

// One brief and one ranking call.
export const maxDuration = 30;

export const OPTIONS = preflight;

export const POST = postRoute(validateGenerate, (body) => getGenerator().designs(body));
