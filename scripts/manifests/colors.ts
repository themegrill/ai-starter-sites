import { ColorOverrides, ColorRole, DemoColor } from '../../lib/demos/types';
import { normalizeColor, toHsl, toOklch } from '../../lib/colors';

export { normalizeColor, toHsl };

// Perceptual chroma, not HSL saturation: HSL calls a warm off-white (#ede9e5)
// or near-black (#15110e) colorful, and they then cluster with a real orange.
// Same threshold as the recoloring's grey (lib/pipeline/color-map.ts).
const GREY_CHROMA = 0.03;
const isNeutral = (hex: string, { l }: { l: number }) => toOklch(hex).c < GREY_CHROMA || l > 0.96 || l < 0.06;

// Zakra's and BlockArt's own default blues. A demo that shows them left a
// setting at its default (link color, theme primary) rather than choosing them,
// so they never make a design's primary and they follow the primary cluster.
const STOCK_COLORS = new Set(['#027abb', '#015ea0', '#1e7ba6', '#2563eb', '#2664eb']);

const hueDistance = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Splits a demo's colors into neutrals (left as they are) and brand hue
 * clusters. The cluster holding the theme's primary color (or the most-used
 * one) becomes primary, the next secondary, the rest accent. All of them follow
 * a new primary (see lib/pipeline/color-map.ts) unless the catalog locks them.
 * Catalog overrides win over this classification.
 */
export const classifyColors = (
	blockCounts: Map<string, number>,
	themeCounts: Map<string, number>,
	themePrimary?: string,
	overrides: ColorOverrides = {},
): DemoColor[] => {
	const counts = new Map(blockCounts);
	themeCounts.forEach((n, hex) => counts.set(hex, (counts.get(hex) ?? 0) + n));
	const entries = [...counts.entries()].sort((a, b) => (blockCounts.get(b[0]) ?? 0) - (blockCounts.get(a[0]) ?? 0) || b[1] - a[1]);
	const colors: DemoColor[] = [];
	const clusters: { base: string; hue: number; total: number; members: string[] }[] = [];
	const declared = themePrimary && !STOCK_COLORS.has(themePrimary) ? themePrimary : undefined;
	const designed = entries.filter(([hex]) => !STOCK_COLORS.has(hex));
	// Only a demo built entirely on the defaults takes them as its own colors.
	const stockIsDesign = !designed.some(([hex]) => hex === declared || !isNeutral(hex, toHsl(hex)));
	const stock = stockIsDesign ? [] : entries.filter(([hex]) => STOCK_COLORS.has(hex)).map(([hex]) => hex);

	for (const [hex, count] of stockIsDesign ? entries : designed) {
		const hsl = toHsl(hex);
		// The theme's declared primary is the brand color even when near-black or grey.
		if (hex !== declared && isNeutral(hex, hsl)) {
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
	const primaryIndex = declared ? clusters.findIndex((c) => c.total > 0 && c.members.includes(declared)) : -1;
	if (primaryIndex > 0) {
		clusters.unshift(...clusters.splice(primaryIndex, 1));
	}
	clusters[0]?.members.push(...stock);

	const listed = (hexes: string[] | undefined, cluster: { members: string[] }) =>
		(hexes ?? []).some((hex) => cluster.members.includes(normalizeColor(hex) ?? ''));

	clusters.forEach((cluster, index) => {
		// Block-used clusters rank first, so a theme-only color is primary only when
		// no block uses a brand color. A one-off color isn't a design's secondary.
		const auto: ColorRole = index === 0 ? 'primary' : index === 1 && cluster.total >= 3 ? 'secondary' : 'accent';
		const override = Object.entries(overrides.roles ?? {}).find(([hex]) => listed([hex], cluster))?.[1];
		const role = override ?? auto;
		const designerLock = listed(overrides.lock, cluster);
		const baseL = toHsl(cluster.base).l;
		for (const hex of cluster.members) {
			colors.push({
				hex,
				count: counts.get(hex) ?? 0,
				group: 'brand',
				role,
				base: cluster.base,
				lightnessDelta: round(toHsl(hex).l - baseL),
				...(designerLock ? { locked: true, lockReason: 'designer' as const } : {}),
			});
		}
	});

	return colors.sort((a, b) => b.count - a.count);
};
