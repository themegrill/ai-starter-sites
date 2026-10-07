import { ApiError } from '@/lib/errors';
import { postRoute, preflight } from '@/lib/http';
import { colorMapFor } from '@/lib/pipeline/color-map';
import { getManifest } from '@/lib/pipeline/pick-demo';
import { validateColorMap } from '@/lib/validate';

export const OPTIONS = preflight;

// Demo color -> brand color map for an edited palette. Pure math, no LLM.
export const POST = postRoute(validateColorMap, async ({ demoSlug, palette }) => {
	const demo = getManifest(demoSlug);
	if (!demo) throw new ApiError('INVALID_INPUT', 'That design is not available.');
	const { map, themeMap } = colorMapFor(demo, palette);
	return { colorMap: map, themeColorMap: themeMap };
});
