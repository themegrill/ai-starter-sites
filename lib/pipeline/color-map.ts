// Demo color -> brand color map. The only implementation: the package carries
// one for the generated palette, and POST /api/color-map rebuilds it when the
// user edits the palette before importing.
import { contrast, fromOklch, mapShade, toOklch } from '../colors';
import { ContrastPair, DemoManifest } from '../demos/types';
import { BrandPalette } from '../types';

const STEP = 0.02;
const PASSES = 3;

// WCAG: 4.5:1, or 3:1 for headings, buttons and icons.
const wcag = (pair: ContrastPair) => (pair.large ? 3 : 4.5);

// Hard minimum. Where the demo itself falls short (white text on a bright
// yellow), the recolored pair only has to match the demo: demanding more
// there can pull a color both ways and lose it.
const floor = (pair: ContrastPair) => Math.min(wcag(pair), contrast(pair.fg, pair.bg));

export type ColorMapResult = {
	map: Record<string, string>; // For page blocks.
	themeMap: Record<string, string>; // For theme settings (header, footer, buttons).
	// Mapped colors that fell back to the demo value: no lightness kept their pairs readable.
	contrastLocked: string[];
};

/**
 * Nudges mapped colors' lightness (0.02 at a time, smallest move first) until
 * every pair they're in meets `need`. Returns the colors that couldn't; with
 * `soft`, those keep their current value instead of failing.
 */
const nudge = (
	map: Record<string, string>,
	byHex: Map<string, ContrastPair[]>,
	need: (pair: ContrastPair) => number,
	soft = false,
): string[] => {
	const color = (hex: string) => map[hex] ?? hex;
	const meets = (hex: string, test = need) => byHex.get(hex)!.every((p) => contrast(color(p.fg), color(p.bg)) >= test(p) - 1e-9);
	// A soft move must also keep every pair above the hard floor.
	const passes = (hex: string) => meets(hex) && (!soft || meets(hex, floor));

	for (let pass = 0; pass < PASSES; pass++) {
		let changed = false;
		for (const hex of byHex.keys()) {
			if (passes(hex)) continue;
			const current = map[hex]!;
			const start = toOklch(current);
			let fixed: string | undefined;
			for (let step = 1; !fixed && step * STEP <= 1; step++) {
				for (const dir of [-1, 1]) {
					const l = start.l + dir * step * STEP;
					if (l < 0 || l > 1) continue;
					map[hex] = fromOklch({ ...start, l });
					if (passes(hex)) {
						fixed = map[hex];
						break;
					}
				}
			}
			map[hex] = fixed ?? current;
			if (fixed) changed = true;
		}
		if (!changed) break;
	}
	return [...byHex.keys()].filter((hex) => !passes(hex));
};

/**
 * Contrast guard. First every pair a mapped color is in must be at least as
 * readable as in the demo (colors that can't be keep their demo value); then,
 * where it fits without breaking that, each color moves on to full WCAG.
 */
const enforceContrast = (map: Record<string, string>, pairs: ContrastPair[]): string[] => {
	const byHex = new Map<string, ContrastPair[]>();
	for (const pair of pairs) {
		for (const hex of [pair.fg, pair.bg]) {
			if (map[hex]) byHex.set(hex, [...(byHex.get(hex) ?? []), pair]);
		}
	}
	const locked = nudge(map, byHex, floor);
	locked.forEach((hex) => {
		delete map[hex];
		byHex.delete(hex);
	});
	nudge(map, byHex, wcag, true);
	return locked;
};

/**
 * Maps the demo's primary and secondary clusters to the palette, then checks
 * contrast separately for page blocks and theme settings. Locked colors
 * (accents, designer locks) and neutrals keep their demo values. Colors the
 * demo uses as backgrounds never get more vivid.
 */
export const colorMapFor = (demo: DemoManifest, palette: BrandPalette): ColorMapResult => {
	const map: Record<string, string> = {};
	for (const color of demo.brand.colors) {
		if (color.group !== 'brand' || color.locked) continue;
		if (color.role !== 'primary' && color.role !== 'secondary') continue;
		map[color.hex] = mapShade(color.hex, color.base ?? color.hex, palette[color.role], !!color.usage?.background);
	}
	const themeMap = { ...map };
	const pairs = demo.brand.contrastPairs ?? [];
	const contrastLocked = [
		...enforceContrast(map, pairs.filter((p) => p.scope !== 'theme')),
		...enforceContrast(themeMap, pairs.filter((p) => p.scope === 'theme')),
	];
	return { map, themeMap, contrastLocked: [...new Set(contrastLocked)] };
};
