// Color math shared by the manifest build and the pipeline. The color map is
// computed only here (served by POST /api/color-map); the plugin never
// recomputes it, so results are identical everywhere.

export type Hsl = { h: number; s: number; l: number };

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(); alpha is dropped.
export const normalizeColor = (value: string): string | undefined => {
	const v = value.trim().toLowerCase();

	const hex = v.match(/^#([0-9a-f]{3,8})$/);
	if (hex?.[1]) {
		const h = hex[1];
		if (h.length === 3 || h.length === 4) {
			return '#' + h.slice(0, 3).split('').map((c) => c + c).join('');
		}
		if (h.length === 6 || h.length === 8) {
			return '#' + h.slice(0, 6);
		}
		return undefined;
	}

	const rgb = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (rgb) {
		return '#' + hex2(Number(rgb[1])) + hex2(Number(rgb[2])) + hex2(Number(rgb[3]));
	}
	return undefined;
};

export const toHsl = (hex: string): Hsl => {
	const n = parseInt(hex.slice(1, 7), 16);
	const r = ((n >> 16) & 255) / 255;
	const g = ((n >> 8) & 255) / 255;
	const b = (n & 255) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	if (d === 0) {
		return { h: 0, s: 0, l };
	}
	const s = d / (1 - Math.abs(2 * l - 1));
	const h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
	return { h, s, l };
};

// ---- OKLCH: perceptual lightness, so a hue swap keeps how light a color looks ----

export type Oklch = { l: number; c: number; h: number };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

const linearRgb = (hex: string) => {
	const n = parseInt(hex.slice(1, 7), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255)) as [number, number, number];
};

export const toOklch = (hex: string): Oklch => {
	const [r, g, b] = linearRgb(hex);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
};

// Linear sRGB for an OKLCH color; may fall outside 0..1 when out of gamut.
const oklchToLinear = ({ l: L, c, h }: Oklch) => {
	const A = c * Math.cos((h * Math.PI) / 180);
	const B = c * Math.sin((h * Math.PI) / 180);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
};

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Out-of-gamut colors keep their lightness and hue and lose chroma until they fit.
export const fromOklch = (color: Oklch): string => {
	const l = clamp(color.l);
	let rgb = oklchToLinear({ ...color, l });
	if (!inGamut(rgb)) {
		let lo = 0;
		let hi = color.c;
		for (let i = 0; i < 20; i++) {
			const mid = (lo + hi) / 2;
			if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
			else hi = mid;
		}
		rgb = oklchToLinear({ l, c: lo, h: color.h });
	}
	return '#' + rgb.map((v) => hex2(fromLinear(clamp(v)) * 255)).join('');
};

// ---- WCAG contrast ----

export const luminance = (hex: string) => {
	const [r, g, b] = linearRgb(hex);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

/**
 * One demo shade recolored to a palette color, in OKLCH: the palette's hue,
 * chroma scaled by how vivid the shade is relative to its cluster base (light
 * tints stay soft), and the shade's own perceptual lightness (so contrast
 * with the neutrals around it survives). `calm` caps chroma at the shade's
 * own, for colors used as backgrounds: a bright yellow band must not turn
 * into a neon green one.
 */
export const mapShade = (shade: string, base: string, target: string, calm = false): string => {
	const from = toOklch(shade);
	const baseC = toOklch(base).c;
	const to = toOklch(target);
	let c = baseC > 0 ? to.c * (from.c / baseC) : to.c;
	if (calm) c = Math.min(c, from.c);
	return fromOklch({ l: from.l, c, h: to.h });
};
