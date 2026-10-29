// Finds which decorative demo images are plain pictograms (a phone, a gear, a
// paw) and records their colors and shape in data/icon-images.json, so a
// generation can swap each one for a BlockArt icon that fits the new copy and
// follows the brand color. A vision model sorts icons from logos, numbers and
// photos; the colors are measured. Review the file by hand, like
// data/photo-descriptions.json. Run with `pnpm icons`, then `pnpm manifests`.
// `pnpm icons --icon <shape> <url>...` marks images the model got wrong as
// icons on that shape (none, circle, square, rounded) and measures them;
// `--measure` measures every icon again.
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { normalizeColor } from '../../lib/colors';
import { DemoManifest } from '../../lib/demos/types';
import { IconImage, IconKind, IconShape, mapLimit, takesIcon } from './images';

const MANIFESTS_DIR = path.join(process.cwd(), 'data', 'manifests');
const OUT_FILE = path.join(process.cwd(), 'data', 'icon-images.json');
const MODEL = 'claude-haiku-5-5';
const BATCH = 12;
const SIZE = 96;
// Pixels this far apart (RGB distance) are different colors, not antialiasing.
const SAME_COLOR = 70;

type Pixel = [number, number, number];
const dist = (a: Pixel, b: Pixel) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = (p: Pixel) => normalizeColor(`rgb(${p.map(Math.round).join(',')})`)!;

// Mean color of the most common coarse color bin.
const dominant = (pixels: Pixel[]): Pixel | undefined => {
	const bins = new Map<string, Pixel[]>();
	for (const p of pixels) {
		const key = p.map((v) => v >> 5).join();
		bins.set(key, [...(bins.get(key) ?? []), p]);
	}
	const best = [...bins.values()].sort((a, b) => b.length - a.length)[0];
	return best && ([0, 1, 2].map((c) => best.reduce((s, p) => s + p[c]!, 0) / best.length) as Pixel);
};

// Glyph and tile colors, and how much of the image the glyph covers. Matching
// corners are the page around the icon; a square tile's fill is its border.
const measure = async (bytes: Buffer, shape: IconShape) => {
	const { data } = await sharp(bytes).ensureAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
	const at = (x: number, y: number) => {
		const i = (y * SIZE + x) * 4;
		return { x, y, rgb: [data[i]!, data[i + 1]!, data[i + 2]!] as Pixel, opaque: data[i + 3]! >= 128 };
	};
	const all = Array.from({ length: SIZE * SIZE }, (_, i) => at(i % SIZE, Math.floor(i / SIZE)));
	const border = all.filter((p) => p.opaque && (p.x === 0 || p.y === 0 || p.x === SIZE - 1 || p.y === SIZE - 1));
	const edge = border.length >= 2 * SIZE ? dominant(border.map((p) => p.rgb)) : undefined;
	// Three matching corners are the page, even when the symbol fills most of the border.
	const corners = [at(0, 0), at(SIZE - 1, 0), at(0, SIZE - 1), at(SIZE - 1, SIZE - 1)].filter((p) => p.opaque);
	const corner = corners.find((c) => corners.filter((o) => dist(o.rgb, c.rgb) <= SAME_COLOR).length >= 3)?.rgb;
	const tile = shape === 'square' || shape === 'rounded';
	const page = tile ? (corner && edge && dist(corner, edge) > SAME_COLOR ? corner : undefined) : corner ?? edge;
	const pixels = all.filter((p) => p.opaque && !(page && dist(p.rgb, page) <= SAME_COLOR));
	const fill = shape === 'none' ? undefined : tile && edge ? edge : dominant(pixels.map((p) => p.rgb));
	const symbol = fill ? pixels.filter((p) => dist(p.rgb, fill) > SAME_COLOR) : pixels;
	const glyph = dominant(symbol.map((p) => p.rgb));
	if (!glyph && !fill) return {};
	const ink = glyph ? symbol.filter((p) => dist(p.rgb, glyph) <= SAME_COLOR) : [];
	const span = (axis: 'x' | 'y') => (ink.length ? Math.max(...ink.map((p) => p[axis])) - Math.min(...ink.map((p) => p[axis])) + 1 : 0);
	return {
		// A symbol cut out of its tile shows the page through it, usually white.
		glyph: glyph ? hex(glyph) : '#ffffff',
		...(fill ? { fill: hex(fill) } : {}),
		scale: Math.round((Math.max(span('x'), span('y')) / SIZE) * 100) / 100 || 0.6,
	};
};

const SYSTEM = `You sort small images from website templates. For each numbered image answer:
- kind: "icon" for a simple pictogram of one thing or idea (phone, gear, heart, truck, check mark, quote marks), drawn flat in one or two colors, maybe on a plain circle or tile. "social" for a social network's mark. "logo" for a company or product logo or wordmark. "number" for digits, dates or years. "photo" for photographs. "ornament" for dividers, flourishes, star ratings and decorative lines. "other" for anything else (screenshots, illustrations with scenes, text).
- shape: the plain shape the symbol sits on: "circle", "square", "rounded" (rounded square), or "none".
- depicts: what the symbol shows, in 1 to 3 words.
Images are shown on a grey background; grey is not part of the image.`;

const SCHEMA = {
	type: 'object',
	properties: {
		images: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					n: { type: 'integer' },
					kind: { type: 'string', enum: ['icon', 'social', 'logo', 'number', 'photo', 'ornament', 'other'] },
					shape: { type: 'string', enum: ['none', 'circle', 'square', 'rounded'] },
					depicts: { type: 'string' },
				},
				required: ['n', 'kind', 'shape', 'depicts'],
				additionalProperties: false,
			},
		},
	},
	required: ['images'],
	additionalProperties: false,
};

type Verdict = { n: number; kind: IconKind; shape: IconShape; depicts: string };

const classify = async (client: Anthropic, thumbs: Buffer[]): Promise<Verdict[]> => {
	const content: Anthropic.ContentBlockParam[] = thumbs.flatMap((png, i) => [
		{ type: 'text' as const, text: `Image ${i + 1}:` },
		{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: png.toString('base64') } },
	]);
	content.push({ type: 'text', text: `Classify all ${thumbs.length} images.` });
	const message = await client.beta.messages.create({
		model: MODEL,
		max_tokens: 16_000,
		system: SYSTEM,
		messages: [{ role: 'user', content }],
		output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' },
	});
	const text = message.content.find((block) => block.type === 'text')?.text ?? '{"images":[]}';
	return (JSON.parse(text) as { images: Verdict[] }).images;
};

const main = async () => {
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set (run with --env-file=.env.local).');
	const client = new Anthropic({ apiKey, maxRetries: 3 });
	const known: Record<string, IconImage> = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, 'utf8')).images : {};

	// After changing how colors are measured: every icon again, no model calls.
	if (process.argv.includes('--measure')) {
		await mapLimit(Object.entries(known).filter(([, v]) => v.kind === 'icon'), 8, async ([url, entry]) => {
			const response = await fetch(url);
			if (response.ok) known[url] = { kind: 'icon', depicts: entry.depicts, shape: entry.shape, ...(await measure(Buffer.from(await response.arrayBuffer()), entry.shape ?? 'none')) };
		});
		return save(known);
	}

	const flag = process.argv.indexOf('--icon');
	if (flag >= 0) {
		const [shape, ...urls] = process.argv.slice(flag + 1) as [IconShape, ...string[]];
		for (const url of urls) {
			const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
			known[url] = { kind: 'icon', depicts: known[url]?.depicts ?? '', shape, ...(await measure(bytes, shape)) };
		}
		return save(known);
	}

	// Decorative images in blocks that can show an icon: image blocks, and
	// headings with an icon as their background. Logo strips never.
	const urls = new Set<string>();
	for (const file of readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
		const demo = JSON.parse(readFileSync(path.join(MANIFESTS_DIR, file), 'utf8')) as DemoManifest;
		for (const section of demo.pages.flatMap((p) => p.sections)) {
			if (section.role === 'logos') continue;
			for (const image of section.images) {
				if (image.decorative && takesIcon(image) && !(image.url in known)) urls.add(image.url);
			}
		}
	}
	console.log(`${urls.size} images to classify`);

	const files = (
		await mapLimit([...urls], 8, async (url) => {
			try {
				const response = await fetch(url);
				if (!response.ok) return null;
				const bytes = Buffer.from(await response.arrayBuffer());
				const thumb = await sharp(bytes).flatten({ background: '#d4d4d4' }).resize(SIZE, SIZE, { fit: 'contain', background: '#d4d4d4' }).png().toBuffer();
				return { url, bytes, thumb };
			} catch {
				return null;
			}
		})
	).filter((f) => f !== null);

	for (let start = 0; start < files.length; start += BATCH) {
		const batch = files.slice(start, start + BATCH);
		const verdicts = await classify(client, batch.map((f) => f.thumb));
		for (const verdict of verdicts) {
			const file = batch[verdict.n - 1];
			if (!file) continue;
			known[file.url] =
				verdict.kind === 'icon'
					? { kind: 'icon', depicts: verdict.depicts, shape: verdict.shape, ...(await measure(file.bytes, verdict.shape)) }
					: { kind: verdict.kind, depicts: verdict.depicts };
		}
		console.log(`${Math.min(start + BATCH, files.length)}/${files.length}`);
	}

	await save(known);
};

const save = async (known: Record<string, IconImage>) => {
	const sorted = Object.fromEntries(Object.entries(known).sort(([a], [b]) => a.localeCompare(b)));
	await writeFile(
		OUT_FILE,
		JSON.stringify(
			{
				$comment:
					'Decorative demo images, keyed by URL. kind "icon" marks plain pictograms that a generation swaps for a BlockArt icon picked for the new copy, drawn in "glyph" on a "fill" circle or tile (shape) at "scale" of the image size. Other kinds stay as they are. Written by `pnpm icons` with a vision model; reviewed by hand.',
				images: sorted,
			},
			null,
			'\t',
		) + '\n',
	);
	console.log(`Wrote ${Object.keys(sorted).length} entries to ${path.relative(process.cwd(), OUT_FILE)}`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
