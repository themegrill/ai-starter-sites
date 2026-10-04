// Step 3: palette and fonts. Curated presets, no LLM, so results stay on-brand
// and legible. Tone picks the font pair; the brand name varies the palette.
import { DemoManifest } from '../demos/types';
import { AiTone, BrandKit, BrandPalette } from '../types';
import { Brief } from './brief';

type Palette = BrandPalette & { tones?: AiTone[] };

const FAMILY_BY_DEMO: Record<string, string> = {
	'restaurant-v2': 'food',
	fitclub: 'fitness',
	'yoga-02': 'wellness',
	'spa-02': 'wellness',
	'agency-03': 'business',
	'lawyer-v2': 'business',
	'plumber-v2': 'trades',
	'construction-02': 'trades',
	eduskill: 'education',
};

const PALETTES: Record<string, Palette[]> = {
	food: [
		{ primary: '#C2410C', secondary: '#FDBA74', accent: '#1E293B', text: '#1F2937', background: '#FFFBF5', tones: ['friendly', 'playful'] },
		{ primary: '#7C2D12', secondary: '#D6B88C', accent: '#14532D', text: '#1C1917', background: '#FAF7F2', tones: ['elegant', 'professional'] },
		{ primary: '#B91C1C', secondary: '#FACC15', accent: '#111827', text: '#111827', background: '#FFFFFF', tones: ['bold'] },
	],
	fitness: [
		{ primary: '#DC2626', secondary: '#FCA5A5', accent: '#0F172A', text: '#18181B', background: '#FAFAFA', tones: ['bold'] },
		{ primary: '#EA580C', secondary: '#FDBA74', accent: '#1E293B', text: '#1F2937', background: '#FFFFFF', tones: ['friendly', 'playful'] },
		{ primary: '#2563EB', secondary: '#93C5FD', accent: '#F59E0B', text: '#0F172A', background: '#F8FAFC', tones: ['professional', 'elegant'] },
	],
	wellness: [
		{ primary: '#4D7C0F', secondary: '#D9F99D', accent: '#7C2D12', text: '#1C1917', background: '#FBFAF5', tones: ['friendly', 'professional'] },
		{ primary: '#9D4E6D', secondary: '#F5D0DC', accent: '#3F3F46', text: '#27272A', background: '#FFF9FB', tones: ['elegant', 'playful'] },
		{ primary: '#0F766E', secondary: '#99F6E4', accent: '#B45309', text: '#134E4A', background: '#F7FBFA', tones: ['bold'] },
	],
	business: [
		{ primary: '#4F46E5', secondary: '#A5B4FC', accent: '#F59E0B', text: '#111827', background: '#FFFFFF', tones: ['friendly', 'playful', 'bold'] },
		{ primary: '#1E3A8A', secondary: '#C7A86B', accent: '#0F172A', text: '#111827', background: '#F8FAFC', tones: ['professional', 'elegant'] },
		{ primary: '#047857', secondary: '#A7F3D0', accent: '#1F2937', text: '#111827', background: '#FFFFFF' },
	],
	trades: [
		{ primary: '#1D4ED8', secondary: '#FBBF24', accent: '#0F172A', text: '#0F172A', background: '#FFFFFF', tones: ['professional', 'friendly'] },
		{ primary: '#EA580C', secondary: '#1E293B', accent: '#FACC15', text: '#111827', background: '#FAFAF9', tones: ['bold', 'playful'] },
		{ primary: '#166534', secondary: '#BEF264', accent: '#1C1917', text: '#1C1917', background: '#FFFFFF', tones: ['elegant'] },
	],
	education: [
		{ primary: '#2563EB', secondary: '#FBBF24', accent: '#1E1B4B', text: '#1E293B', background: '#FFFFFF', tones: ['friendly', 'playful'] },
		{ primary: '#7C3AED', secondary: '#C4B5FD', accent: '#F59E0B', text: '#1F2937', background: '#FAF5FF', tones: ['bold'] },
		{ primary: '#0E7490', secondary: '#A5F3FC', accent: '#1E293B', text: '#0F172A', background: '#F8FAFC', tones: ['professional', 'elegant'] },
	],
};

// Google Fonts pairs (heading, body) per tone.
const FONTS: Record<AiTone, { heading: string; body: string }[]> = {
	friendly: [
		{ heading: 'Nunito', body: 'Nunito Sans' },
		{ heading: 'Poppins', body: 'Inter' },
	],
	professional: [
		{ heading: 'Inter', body: 'Inter' },
		{ heading: 'Manrope', body: 'Source Sans 3' },
	],
	bold: [
		{ heading: 'Montserrat', body: 'Inter' },
		{ heading: 'Oswald', body: 'Lato' },
	],
	elegant: [
		{ heading: 'Playfair Display', body: 'Lato' },
		{ heading: 'Cormorant Garamond', body: 'Montserrat' },
	],
	playful: [
		{ heading: 'Fredoka', body: 'Nunito' },
		{ heading: 'Baloo 2', body: 'Poppins' },
	],
};

const hash = (s: string) => [...s.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export const pickBrandKit = (demo: DemoManifest, tone: AiTone, brandName: string, brief: Brief): BrandKit => {
	const palettes = PALETTES[FAMILY_BY_DEMO[demo.slug] ?? 'business'] ?? PALETTES.business!;
	const toned = palettes.filter((p) => p.tones?.includes(tone));
	const pool = toned.length ? toned : palettes;
	const { tones, ...palette } = pool[hash(brandName) % pool.length]!;
	const fonts = FONTS[tone][hash(brandName + tone) % FONTS[tone].length]!;

	return { siteTitle: brandName, tagline: brief.tagline, palette, fonts };
};

// ---- Color mapping -------------------------------------------------------

const toHsl = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (!d) return { h: 0, s: 0, l };
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
	return { h, s, l };
};

const toHex = ({ h, s, l }: { h: number; s: number; l: number }) => {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};

/**
 * Maps each demo brand color to the new palette: hue and saturation from the
 * palette color for its role, lightness kept from the demo. The demo's
 * light/dark contrast survives any palette. Neutrals are left alone.
 */
export const buildColorMap = (demo: DemoManifest, palette: BrandPalette): Record<string, string> => {
	const map: Record<string, string> = {};
	for (const color of demo.brand.colors) {
		if (color.group !== 'brand') continue;
		const target = palette[color.role === 'secondary' ? 'secondary' : color.role === 'accent' ? 'accent' : 'primary'];
		const { h, s } = toHsl(target);
		map[color.hex] = toHex({ h, s, l: toHsl(color.hex).l });
	}
	return map;
};

export const buildFontMap = (demo: DemoManifest, fonts: BrandKit['fonts']): Record<string, string> =>
	Object.fromEntries(Object.entries(demo.brand.fonts.map).map(([family, role]) => [family, fonts[role]]));
