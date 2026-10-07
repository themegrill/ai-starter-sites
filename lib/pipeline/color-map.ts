// Demo color -> brand color map. The only implementation: the package carries
// one for the generated palette, and POST /api/color-map rebuilds it when the
// user edits the palette before importing.
import { mapShade } from '../colors';
import { DemoManifest } from '../demos/types';
import { BrandPalette } from '../types';

/**
 * Maps the demo's primary and secondary clusters to the palette. Locked
 * colors (accents, designer locks) and neutrals keep their demo values.
 */
export const buildColorMap = (demo: DemoManifest, palette: BrandPalette): Record<string, string> => {
	const map: Record<string, string> = {};
	for (const color of demo.brand.colors) {
		if (color.group !== 'brand' || color.locked) continue;
		if (color.role !== 'primary' && color.role !== 'secondary') continue;
		map[color.hex] = mapShade(color.hex, color.base ?? color.hex, palette[color.role]);
	}
	return map;
};
