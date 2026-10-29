import { ApiError } from '@/lib/errors';
import { postRoute, preflight } from '@/lib/http';
import { brandPalette } from '@/lib/pipeline/brand-kit';
import { colorMapFor } from '@/lib/pipeline/color-map';
import { getManifest } from '@/lib/pipeline/pick-demo';
import { validateColorMap } from '@/lib/validate';

export const OPTIONS = preflight;

// Demo color -> brand color map for a changed primary color, and the palette
// it gives (for the preview's swatches). Pure math, no LLM.
export const POST = postRoute(validateColorMap, async ({ demoSlug, primaryColor }) => {
	const demo = getManifest(demoSlug);
	if (!demo) throw new ApiError('INVALID_INPUT', 'That design is not available.');
	const { map, themeMap } = colorMapFor(demo, primaryColor);
	return { colorMap: map, themeColorMap: themeMap, palette: brandPalette(demo, primaryColor) };
});
