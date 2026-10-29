// Step 5b: the demo's pictograms (manifest `icon`) become BlockArt icons that
// fit the new copy, in the brand color. One LLM call names a Font Awesome icon
// for each from the text beside it; symbols that mean the same anywhere (check
// marks, quote marks) keep theirs. A drone design's gear becomes a paw for a
// pet shop, and a red icon becomes the user's green.
import { contrast, fromOklch, Oklch, toOklch } from '../colors';
import { DemoManifest, ImageIcon, ImageSlot as ManifestImage, ManifestPage, ManifestSection } from '../demos/types';
import { resolveIcon } from '../icons';
import { getLlm, LlmUsage } from '../llm';
import { GenerateRequest, IconSlot } from '../types';
import { Brief } from './brief';
import { colorMapFor } from './color-map';
import { CopyResult } from './copy';

const SYSTEM = `You pick icons for a website built from a template. Each numbered item is an icon slot with the text it sits beside, rewritten for this business. Name one Font Awesome 6 Free icon (solid style) for each that shows what that text is about.
- Use real Font Awesome names in kebab-case without a prefix: "paw", "truck-fast", "keyboard", "mug-hot", "user-doctor", "shield-halved".
- A concrete object beats an abstract symbol: "scissors" for a haircut, "tooth" for dental care.
- Items in the same section get different icons.
- Never a brand or logo icon.`;

// Text this long is enough to tell what a card is about.
const CONTEXT_CHARS = 140;
const FALLBACK_ICON = 'circle-check-solid';

type IconJob = { key: string; image: ManifestImage; icon: ImageIcon; section: ManifestSection; text: string };

const sharedDepth = (a: string, b: string) => {
	const [x, y] = [a.split('.'), b.split('.')];
	let depth = 0;
	while (depth < x.length && x[depth] === y[depth]) depth++;
	return depth;
};

// The new copy of the slots closest to the image in the block tree: the card it sits in.
const textBeside = (page: ManifestPage, section: ManifestSection, image: ManifestImage, copy: CopyResult) => {
	const slots = section.slots.filter((s) => s.text.trim());
	const depth = Math.max(0, ...slots.map((s) => sharedDepth(s.path, image.path)));
	return slots
		.filter((s) => sharedDepth(s.path, image.path) === depth)
		.slice(0, 2)
		.map((s) => copy[page.slug]?.[s.id] ?? s.text)
		.join(' — ')
		.slice(0, CONTEXT_CHARS);
};

const pickIcons = async (
	ctx: { request: GenerateRequest; brief: Brief },
	jobs: IconJob[],
	signal?: AbortSignal,
): Promise<{ names: Map<string, string>; usage: LlmUsage }> => {
	const lines = [
		`Business: ${ctx.request.brandName}, a ${ctx.brief.businessType}. ${ctx.brief.summary}`,
		'',
		...jobs.map((j) => `${j.key} | ${j.section.role} section "${j.section.title ?? ''}" | text: ${j.text || '(none)'} | template icon: ${j.icon.depicts}`),
	];
	const { data, usage } = await getLlm().json<Record<string, string>>({
		name: 'icons',
		system: SYSTEM,
		user: lines.join('\n'),
		schema: {
			type: 'object',
			properties: Object.fromEntries(jobs.map((j) => [j.key, { type: 'string' }])),
			required: jobs.map((j) => j.key),
			additionalProperties: false,
		},
		maxTokens: 500 + jobs.length * 20,
		temperature: 0.2,
		signal,
	});
	return { names: new Map(Object.entries(data)), usage };
};

// A measured icon color counts as the demo's primary within this distance (OKLab).
const SNAP = 0.06;
const GREY = 0.03;
// A tile this tinted is a pale wash of a color, not white or grey.
const TINT = 0.012;
const STEP = 0.02;

const oklabDistance = (a: Oklch, b: Oklch) => {
	const ab = (o: Oklch) => [o.c * Math.cos((o.h * Math.PI) / 180), o.c * Math.sin((o.h * Math.PI) / 180)];
	const [[a1, a2], [b1, b2]] = [ab(a), ab(b)];
	return Math.hypot(a.l - b.l, a1! - b1!, a2! - b2!);
};

// Lightness steps on `color` until it reads on `against` at `need`, or as close as it gets.
const nudge = (color: string, against: string, need: number) => {
	const start = toOklch(color);
	const dir = toOklch(against).l > 0.6 ? -1 : 1;
	let out = color;
	for (let step = 1; contrast(out, against) < need && step * STEP <= 1; step++) {
		out = fromOklch({ ...start, l: Math.min(1, Math.max(0, start.l + dir * step * STEP)) });
	}
	return out;
};

/**
 * Icon colors for the new brand: icons are drawn in it. A colorful symbol,
 * or a circle or tile in the demo's own primary (even a near-black one), takes
 * the primary; any other tinted tile a wash of it at its own lightness; white,
 * grey and black stay. Then whichever part is colorful moves until the
 * symbol reads on its tile, or on what it sits on, at least as well as in the demo.
 */
export const iconColors = (demo: DemoManifest, icon: ImageIcon, primary: string) => {
	const { map } = colorMapFor(demo, primary);
	const brand = toOklch(primary);
	const demoPrimaries = demo.brand.colors.filter((c) => c.group === 'brand' && c.role === 'primary').map((c) => toOklch(c.hex));
	const isPrimary = (hex: string) => demoPrimaries.some((p) => oklabDistance(toOklch(hex), p) < SNAP);
	const colorful = (hex: string, min = GREY) => toOklch(hex).c >= min || isPrimary(hex);

	let glyph = colorful(icon.glyph) ? primary : icon.glyph;
	const wash = (hex: string) => {
		if (isPrimary(hex)) return primary;
		const own = toOklch(hex);
		return fromOklch({ l: own.l, c: Math.min(own.c, brand.c), h: brand.h });
	};
	const tinted = !!icon.shape && colorful(icon.shape.fill, TINT);
	let fill = icon.shape && (tinted ? wash(icon.shape.fill) : icon.shape.fill);

	const page = icon.background ?? '#ffffff';
	const need = Math.min(3, contrast(icon.glyph, icon.shape?.fill ?? page));
	if (fill && tinted && !colorful(icon.glyph)) fill = nudge(fill, glyph, need);
	else glyph = nudge(glyph, fill ?? map[page] ?? page, need);
	return { glyph, fill };
};

const RADIUS = { circle: 50, rounded: 20, square: 0 } as const;

export const iconSlot = (demo: DemoManifest, icon: ImageIcon, name: string, primary: string): IconSlot => {
	const { glyph, fill } = iconColors(demo, icon, primary);
	return {
		icon: name,
		color: glyph,
		size: icon.size,
		...(icon.shape && fill
			? {
					shape: {
						color: fill,
						radius: RADIUS[icon.shape.kind],
						padding: Math.max(0, Math.round((icon.shape.size - icon.size) / 2)),
					},
				}
			: {}),
	};
};

/**
 * BlockArt icons for every pictogram on the pages. Never fails: without the
 * LLM's names, each keeps a symbol for what the demo's icon showed.
 */
export const iconsFor = async (
	ctx: { request: GenerateRequest; brief: Brief; demo: DemoManifest },
	pages: ManifestPage[],
	copy: CopyResult,
	primary: string,
	signal?: AbortSignal,
): Promise<Map<ManifestImage, IconSlot>> => {
	const jobs: IconJob[] = [];
	for (const page of pages) {
		for (const section of page.sections) {
			for (const image of section.images) {
				if (!image.icon) continue;
				jobs.push({
					key: `i${jobs.length + 1}`,
					image,
					icon: image.icon,
					section,
					text: textBeside(page, section, image, copy),
				});
			}
		}
	}
	const open = jobs.filter((j) => !j.icon.fixed);
	let names = new Map<string, string>();
	if (open.length) {
		try {
			const picked = await pickIcons(ctx, open, signal);
			names = picked.names;
			console.log(`[icons] ${open.length} icons: ${picked.usage.inputTokens} in / ${picked.usage.outputTokens} out tokens, ${picked.usage.ms}ms`);
		} catch (error) {
			if (signal?.aborted) throw error;
			console.warn('[icons] picking failed, using fallbacks:', error instanceof Error ? error.message : error);
		}
	}

	const result = new Map<ManifestImage, IconSlot>();
	for (const job of jobs) {
		const name = job.icon.fixed ?? resolveIcon(names.get(job.key) ?? '') ?? resolveIcon(job.icon.depicts) ?? FALLBACK_ICON;
		result.set(job.image, iconSlot(ctx.demo, job.icon, name, primary));
	}
	return result;
};
