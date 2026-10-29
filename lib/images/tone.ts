// A photo's tone: brightness in a 3x3 grid (so where it is dark or light
// matters, not just how dark overall), its average color, and its dominant
// hue and how colorful it is. Demo photos are measured at manifest build time
// and stock candidates at generation time, so a replacement can be picked that
// sits under the same text the same way and suits the brand color.
import sharp from 'sharp';
import { hueDistance, rgbToOklch, toOklch } from '../colors';
import { Tone } from '../demos/types';

const SIZE = 48;
const CELLS = 3;
// Pixels below this OKLCH chroma are greys and don't count toward the hue.
const VIVID_CHROMA = 0.05;
// Mean vivid chroma per pixel that counts as fully colorful.
const FULL_VIVID = 0.08;
const HUE_BINS = 24;

const round = (n: number) => Math.round(n * 100) / 100;

export const toneOf = async (image: Uint8Array): Promise<Tone> => {
	const { data } = await sharp(image)
		.flatten({ background: '#ffffff' })
		.resize(SIZE, SIZE, { fit: 'fill' })
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const sums = new Array<number>(CELLS * CELLS).fill(0);
	const rgb = [0, 0, 0];
	const hues = new Array<number>(HUE_BINS).fill(0);
	const cell = SIZE / CELLS;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const i = (y * SIZE + x) * 3;
			const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
			rgb[0]! += r;
			rgb[1]! += g;
			rgb[2]! += b;
			sums[Math.floor(y / cell) * CELLS + Math.floor(x / cell)]! += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			const { c, h } = rgbToOklch(r, g, b);
			if (c >= VIVID_CHROMA) hues[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS]! += c;
		}
	}
	const pixels = SIZE * SIZE;
	const hex = rgb.map((c) => Math.round(c / pixels).toString(16).padStart(2, '0')).join('');
	return { grid: sums.map((s) => round(s / (cell * cell))), color: `#${hex}`, ...dominantHue(hues, pixels) };
};

// The strongest hue band and its neighbours, averaged on the circle.
const dominantHue = (bins: number[], pixels: number) => {
	const total = bins.reduce((a, b) => a + b, 0);
	if (!total) return { vivid: 0 };
	const peak = bins.indexOf(Math.max(...bins));
	let [x, y] = [0, 0];
	for (const offset of [-1, 0, 1]) {
		const bin = (peak + offset + HUE_BINS) % HUE_BINS;
		const angle = ((bin + 0.5) * (360 / HUE_BINS) * Math.PI) / 180;
		x += bins[bin]! * Math.cos(angle);
		y += bins[bin]! * Math.sin(angle);
	}
	const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
	return { hue: Math.round(hue), vivid: round(Math.min(1, total / pixels / FULL_VIVID)) };
};

// Within this hue distance a photo's color goes with the brand color; past
// NEAR_HUE + CLASH_RAMP it fights it fully.
const NEAR_HUE = 35;
const CLASH_RAMP = 60;
const GREY_BRAND = 0.03;

// How much a photo's color fights the brand color: 0 for a muted photo or one
// near the brand's hue, up to 1 for a vivid photo of a far hue (a yellow wall
// on an indigo site). A grey brand goes with anything.
export const colorClash = (tone: Pick<Tone, 'hue' | 'vivid'>, primary: string) => {
	const brand = toOklch(primary);
	if (tone.hue === undefined || !tone.vivid || brand.c < GREY_BRAND) return 0;
	const far = Math.min(1, Math.max(0, (hueDistance(tone.hue, brand.h) - NEAR_HUE) / CLASH_RAMP));
	return round(tone.vivid * far);
};

export const brightness = (tone: Tone) => tone.grid.reduce((a, b) => a + b, 0) / tone.grid.length;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// 0 for the same tone; brightness layout counts most, color less.
export const toneDistance = (a: Tone, b: Tone) => {
	const layout = a.grid.reduce((sum, v, i) => sum + Math.abs(v - (b.grid[i] ?? v)), 0) / a.grid.length;
	const [ca, cb] = [channels(a.color), channels(b.color)];
	const color = Math.hypot(ca[0]! - cb[0]!, ca[1]! - cb[1]!, ca[2]! - cb[2]!) / 441;
	return layout + 0.25 * color;
};

const columns = (tone: Tone) => [0, 1, 2].map((c) => (tone.grid[c]! + tone.grid[c + 3]! + tone.grid[c + 6]!) / 3);

// Max overlay opacity: heavy on the demo's darkest column (usually where the
// text sits), lighter elsewhere so the photo still shows.
const MAX_TEXT_SIDE = 0.75;
const MAX_ELSEWHERE = 0.45;

// Left-to-right gradient overlay that brings a background photo back to the
// demo photo's brightness, column by column, so the text designed for the demo
// stays readable: black to darken, white to lighten. Undefined when close enough.
export const overlayFor = (demo: Tone, photo: Tone): string | undefined => {
	const [target, actual] = [columns(demo), columns(photo)];
	const textSide = target.indexOf(Math.min(...target));
	const darken = brightness(photo) >= brightness(demo);
	const alphas = target.map((t, i) => {
		const a = actual[i]!;
		const needed = darken ? (a > 0 ? 1 - t / a : 0) : a < 1 ? (t - a) / (1 - a) : 0;
		return round(Math.min(i === textSide ? MAX_TEXT_SIDE : MAX_ELSEWHERE, Math.max(0, needed)));
	});
	if (Math.max(...alphas) < 0.12) return undefined;

	const rgb = darken ? '0, 0, 0' : '255, 255, 255';
	const stops = alphas.map((a, i) => `rgba(${rgb}, ${a}) ${[0, 50, 100][i]}%`);
	return `linear-gradient(90deg, ${stops.join(', ')})`;
};
