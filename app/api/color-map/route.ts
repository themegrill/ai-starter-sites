import { ApiError } from '@/lib/errors';
import { postRoute, preflight } from '@/lib/http';
import { buildColorMap } from '@/lib/pipeline/color-map';
import { getManifest } from '@/lib/pipeline/pick-demo';
import { validateColorMap } from '@/lib/validate';

export const OPTIONS = preflight;

// Demo color -> brand color map for an edited palette. Pure math, no LLM.
export const POST = postRoute(validateColorMap, async ({ demoSlug, palette }) => {
	const demo = getManifest(demoSlug);
	if (!demo) throw new ApiError('INVALID_INPUT', 'That design is not available.');
	return { colorMap: buildColorMap(demo, palette) };
});
