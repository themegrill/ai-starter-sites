// Demo color -> brand color map, from one primary color. The only
// implementation: the package carries one for the generated brand, and POST
// /api/color-map rebuilds it when the user changes the color before importing.
import { contrast, fromOklch, hueDistance, Oklch, toOklch } from '../colors';
import { ContrastPair, DemoManifest } from '../demos/types';

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

// Below this chroma a color reads as grey and its hue means nothing.
const GREY_CHROMA = 0.03;
// Secondary and accent colors this close in hue to the demo's primary were
// built from it and follow it; further ones are the design's own contrast or
// mean something (social icons, an alert red) and stay.
const FOLLOW_HUE = 30;
// A kept secondary this close to the new primary would merge with it.
const CLASH_HUE = 30;
// A neutral tinted at least this much toward the primary (a warm cream beside
// an orange) follows it.
const TINT_CHROMA = 0.006;
const TINT_HUE = 30;
// A following color this light is a wash of the brand color (a pale band
// behind a section): it takes the new primary's hue exactly, not its old offset.
const WASH_LIGHTNESS = 0.85;

// The demo's own primary: the base of its primary hue cluster.
export const demoPrimary = (demo: DemoManifest): string | undefined =>
	demo.brand.colors.find((c) => c.group === 'brand' && c.role === 'primary')?.base;

// Lightness relative to the old primary, carried to the new one: a tint
// halfway to white stays halfway to white, a shade halfway to black likewise.
const carryLightness = (l: number, from: number, to: number) =>
	l >= from ? to + (from < 1 ? (l - from) / (1 - from) : 0) * (1 - to) : to * (from > 0 ? l / from : 0);

/**
 * Demo color -> recolored color, for a new primary. Colors follow it as
 * closely as they followed the demo's primary:
 * - the primary cluster takes the new primary exactly, its tints and shades
 *   as far from it as they were from the old one;
 * - secondary and accents near the old primary's hue turn with it, never
 *   more vivid than in the demo (pale washes take its hue exactly); distant ones stay, except a secondary the
 *   new primary lands on, which becomes the old primary (two-tone stays two-tone);
 * - neutrals tinted toward the old primary turn with it; plain greys stay.
 * Designer-locked colors (catalog overrides) keep their demo values.
 */
const recolor = (demo: DemoManifest, primary: string): Record<string, string> => {
	const old = demoPrimary(demo);
	if (!old || old === primary) return {};
	const from = toOklch(old);
	const to = toOklch(primary);
	// A grey on either side has no hue to turn from or to: only the primary cluster changes.
	const grey = from.c < GREY_CHROMA || to.c < GREY_CHROMA;
	const turn = (h: number) => (h + to.h - from.h + 360) % 360;
	const follow = (shade: Oklch) => (shade.l >= WASH_LIGHTNESS ? to.h : turn(shade.h));
	const ratio = from.c > 0 ? to.c / from.c : 1;

	const map: Record<string, string> = {};
	for (const color of demo.brand.colors) {
		if (color.lockReason === 'designer') continue;
		const shade = toOklch(color.hex);
		const base = toOklch(color.base ?? color.hex);
		const hue = base.h;
		let next: Oklch | undefined;
		if (color.role === 'primary') {
			let c = from.c >= GREY_CHROMA ? shade.c * ratio : to.c;
			// Bands and fills in a lighter or darker primary never get more vivid; the base itself is the user's pick.
			if (color.usage?.background) c = Math.min(c, shade.c);
			next = { l: carryLightness(shade.l, from.l, to.l), c, h: to.h };
		} else if (grey) {
			continue;
		} else if (color.group === 'brand' && hueDistance(hue, from.h) <= FOLLOW_HUE) {
			next = { l: shade.l, c: shade.c * Math.min(1, ratio), h: follow(shade) };
		} else if (color.group === 'brand' && color.role === 'secondary' && hueDistance(hue, to.h) <= CLASH_HUE) {
			// Its shades sit around the old primary as they sat around their own base.
			next = { l: from.l + shade.l - base.l, c: base.c > 0 ? from.c * (shade.c / base.c) : from.c, h: from.h };
		} else if (color.group === 'neutral' && shade.c >= TINT_CHROMA && hueDistance(shade.h, from.h) <= TINT_HUE) {
			next = { ...shade, h: follow(shade) };
		}
		if (next) map[color.hex] = color.hex === old ? primary : fromOklch(next);
	}
	return map;
};

/**
 * Recolors the demo around a new primary (see recolor), then checks contrast
 * separately for page blocks and theme settings.
 */
export const colorMapFor = (demo: DemoManifest, primary: string): ColorMapResult => {
	const map = recolor(demo, primary.toLowerCase());
	const themeMap = { ...map };
	const pairs = demo.brand.contrastPairs ?? [];
	const contrastLocked = [
		...enforceContrast(map, pairs.filter((p) => p.scope !== 'theme')),
		...enforceContrast(themeMap, pairs.filter((p) => p.scope === 'theme')),
	];
	return { map, themeMap, contrastLocked: [...new Set(contrastLocked)] };
};
