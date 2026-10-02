import { getGenerator } from '@/lib/generator';
import { postRoute, preflight } from '@/lib/http';
import { validateRegenerate } from '@/lib/validate';

export const maxDuration = 30;

export const OPTIONS = preflight;

export const POST = postRoute(validateRegenerate, (body) => getGenerator().regenerateSection(body));
