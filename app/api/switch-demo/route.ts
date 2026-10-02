import { getGenerator } from '@/lib/generator';
import { postRoute, preflight } from '@/lib/http';
import { validateSwitchDemo } from '@/lib/validate';

export const maxDuration = 60;

export const OPTIONS = preflight;

export const POST = postRoute(validateSwitchDemo, (body) => getGenerator().switchDemo(body));
