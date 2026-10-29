// Step 3: colors and fonts. The demo's own design, recolored around one
// primary color: the user's pick, or the demo's own when they kept it. Fonts
// stay the demo's; the user can change them in WordPress later.
import { DemoManifest } from '../demos/types';
import { BrandKit, BrandPalette } from '../types';
import { Brief } from './brief';
import { toOklch } from '../colors';
import { colorMapFor, demoPrimary } from './color-map';

// Only for a demo without any brand color, where it changes nothing.
const FALLBACK_PRIMARY = '#2563eb';

// A shade this much lighter or darker than the others reads as its own swatch.
const DISTINCT_LIGHTNESS = 0.1;

// The palette the plugin shows: the demo's main colors after recoloring.
// Colors are sorted by use, so the first match is the most used.
export const brandPalette = (demo: DemoManifest, primary: string): BrandPalette => {
	const { map } = colorMapFor(demo, primary);
	const colors = demo.brand.colors;
	const mapped = (color: DemoManifest['brand']['colors'][number]) => map[color.hex] ?? color.hex;
	const first = (test: (c: DemoManifest['brand']['colors'][number]) => boolean) => {
		const color = colors.find(test);
		return color && mapped(color);
	};
	// A one-color design fills the gaps with the primary's own tints and shades
	// that the site uses (a dark button fill, a pale band), not copies of it.
	const shades = colors.filter((c) => c.group === 'brand' && c.role === 'primary').map(mapped);
	const distinctShade = (...taken: string[]) =>
		shades.find((hex) => taken.every((t) => Math.abs(toOklch(hex).l - toOklch(t).l) >= DISTINCT_LIGHTNESS));
	const secondary = first((c) => c.group === 'brand' && c.role === 'secondary') ?? distinctShade(primary) ?? primary;
	return {
		primary,
		secondary,
		accent: first((c) => c.group === 'brand' && c.role === 'accent') ?? distinctShade(primary, secondary) ?? secondary,
		text: first((c) => c.group === 'neutral' && c.role === 'text') ?? '#111827',
		background: first((c) => c.group === 'neutral' && c.role === 'background') ?? '#ffffff',
	};
};

export const brandKitFor = (demo: DemoManifest, brandName: string, brief: Brief, primaryColor?: string): BrandKit => ({
	siteTitle: brandName,
	tagline: brief.tagline,
	palette: brandPalette(demo, primaryColor ?? demoPrimary(demo) ?? FALLBACK_PRIMARY),
	fonts: { heading: demo.brand.fonts.heading, body: demo.brand.fonts.body },
});

// Demo font family -> new family, for the roles whose font changed.
export const buildFontMap = (demo: DemoManifest, fonts: BrandKit['fonts']): Record<string, string> =>
	Object.fromEntries(
		Object.entries(demo.brand.fonts.map)
			.filter(([, role]) => fonts[role] !== demo.brand.fonts[role])
			.map(([family, role]) => [family, fonts[role]]),
	);
