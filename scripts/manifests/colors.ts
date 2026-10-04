import { ColorRole, DemoColor } from '../../lib/demos/types';

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

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

export const toHsl = (hex: string) => {
	const n = parseInt(hex.slice(1), 16);
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
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	h = (h * 60 + 360) % 360;
	return { h, s, l };
};

const isNeutral = ({ s, l }: { s: number; l: number }) => s < 0.18 || l > 0.96 || l < 0.06;

const hueDistance = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Splits a demo's colors into neutrals (kept, or mapped to text/background)
 * and brand hue clusters. The cluster holding the theme's primary color (or
 * the most-used one) becomes primary, the next secondary, the rest accent.
 */
export const classifyColors = (
	blockCounts: Map<string, number>,
	themeCounts: Map<string, number>,
	themePrimary?: string,
): DemoColor[] => {
	const counts = new Map(blockCounts);
	themeCounts.forEach((n, hex) => counts.set(hex, (counts.get(hex) ?? 0) + n));
	const entries = [...counts.entries()].sort((a, b) => (blockCounts.get(b[0]) ?? 0) - (blockCounts.get(a[0]) ?? 0) || b[1] - a[1]);
	const colors: DemoColor[] = [];
	const clusters: { base: string; hue: number; total: number; members: string[] }[] = [];

	for (const [hex, count] of entries) {
		const hsl = toHsl(hex);
		if (isNeutral(hsl)) {
			const role: ColorRole = hsl.l >= 0.9 ? 'background' : hsl.l <= 0.3 ? 'text' : 'muted';
			colors.push({ hex, count, group: 'neutral', role });
			continue;
		}
		const cluster = clusters.find((c) => hueDistance(c.hue, hsl.h) <= 22);
		// Rank by what the pages use; theme defaults (link colors etc.) that no
		// block uses must not outrank the design's real accent.
		const used = blockCounts.get(hex) ?? 0;
		if (cluster) {
			cluster.total += used;
			cluster.members.push(hex);
		} else {
			clusters.push({ base: hex, hue: hsl.h, total: used, members: [hex] });
		}
	}

	clusters.sort((a, b) => b.total - a.total);
	const primaryIndex = themePrimary
		? clusters.findIndex((c) => c.total > 0 && c.members.includes(themePrimary))
		: -1;
	if (primaryIndex > 0) {
		clusters.unshift(...clusters.splice(primaryIndex, 1));
	}

	clusters.forEach((cluster, index) => {
		// A one-off color isn't a design's secondary; it needs a few uses.
		const role: ColorRole =
			index === 0 && cluster.total > 0 ? 'primary' : index === 1 && cluster.total >= 3 ? 'secondary' : 'accent';
		const baseL = toHsl(cluster.base).l;
		for (const hex of cluster.members) {
			colors.push({
				hex,
				count: counts.get(hex) ?? 0,
				group: 'brand',
				role,
				base: cluster.base,
				lightnessDelta: round(toHsl(hex).l - baseL),
			});
		}
	});

	return colors.sort((a, b) => b.count - a.count);
};
