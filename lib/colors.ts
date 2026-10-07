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

export const toHex = ({ h, s, l }: Hsl): string => {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
	return '#' + [r, g, b].map((v) => hex2((v + m) * 255)).join('');
};

/**
 * One demo shade recolored to a palette color: the palette's hue, saturation
 * scaled by how saturated the shade is relative to its cluster base (so light
 * tints stay soft), and the shade's own lightness (so contrast survives).
 */
export const mapShade = (shade: string, base: string, target: string): string => {
	const from = toHsl(shade);
	const baseS = toHsl(base).s;
	const to = toHsl(target);
	const s = baseS > 0 ? clamp(to.s * (from.s / baseS)) : to.s;
	return toHex({ h: to.h, s, l: from.l });
};
