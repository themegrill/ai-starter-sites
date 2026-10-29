// Reads image dimensions from the first bytes of each file (a Range request),
// so the pipeline can match stock photos by orientation, cached in
// .cache/image-sizes.json. What each photo shows comes from the hand-reviewed
// data/photo-descriptions.json, so the pipeline can search for a matching one.
import { imageSize } from 'image-size';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageIcon, ImageSlot, Orientation, Tone } from '../../lib/demos/types';
import { toneOf } from '../../lib/images/tone';
import { refresh } from './source';

type Size = { width: number; height: number } | null;

const CACHE_FILE = path.join(process.cwd(), '.cache', 'image-sizes.json');
let cache: Record<string, Size> | null = null;

const loadCache = async () => {
	if (cache) return cache;
	cache = !refresh && existsSync(CACHE_FILE) ? JSON.parse(await readFile(CACHE_FILE, 'utf8')) : {};
	return cache!;
};

export const saveImageCache = async () => {
	if (!cache) return;
	await mkdir(path.dirname(CACHE_FILE), { recursive: true });
	await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1));
};

const fromFilename = (url: string): Size => {
	const match = url.match(/-(\d{2,5})x(\d{2,5})\.\w+$/);
	return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};

const download = async (url: string, bytes?: number) => {
	const response = await fetch(url, bytes ? { headers: { Range: `bytes=0-${bytes - 1}` } } : undefined);
	if (!response.ok && response.status !== 206) {
		throw new Error(`${response.status}`);
	}
	return new Uint8Array(await response.arrayBuffer());
};

const measure = async (url: string): Promise<Size> => {
	for (const bytes of [128 * 1024, undefined]) {
		try {
			const { width, height } = imageSize(await download(url, bytes));
			if (width && height) return { width, height };
		} catch {
			// Header not in the first chunk, or not an image: try the full file.
		}
	}
	return fromFilename(url);
};

export const getImageSize = async (url: string): Promise<Size> => {
	const sizes = await loadCache();
	if (!(url in sizes)) {
		sizes[url] = await measure(url);
	}
	return sizes[url] ?? null;
};

const orientationOf = (width: number, height: number): Orientation => {
	const ratio = width / height;
	return ratio > 1.15 ? 'landscape' : ratio < 0.87 ? 'portrait' : 'square';
};

const DECORATIVE_NAME = /logo|icon|signature|badge|pattern|shape|vector|arrow|dots?[-_.]|quote|partner|sponsor|client-?\d/i;

// Icons, logos and small artwork stay as designed; only photo-sized images
// get stock replacements.
export const describeImage = async (url: string): Promise<Pick<ImageSlot, 'width' | 'height' | 'orientation' | 'decorative'>> => {
	const size = await getImageSize(url);
	const file = url.split('/').pop() ?? '';
	const longest = size ? Math.max(size.width, size.height) : Infinity;
	const photoFormat = /\.(jpe?g|webp)$/i.test(file);
	const decorative =
		/\.svg$/i.test(file) || DECORATIVE_NAME.test(file) || longest < 120 || (!photoFormat && longest < 300);

	return size
		? { width: size.width, height: size.height, orientation: orientationOf(size.width, size.height), decorative }
		: { decorative };
};

type Description = Pick<ImageSlot, 'subject' | 'description' | 'decorative'>;

const DESCRIPTIONS_FILE = path.join(process.cwd(), 'data', 'photo-descriptions.json');
let descriptions: Record<string, Description> | null = null;

// From data/photo-descriptions.json; undefined for photos not described yet.
export const describePhoto = (url: string): Description | undefined => {
	descriptions ??= existsSync(DESCRIPTIONS_FILE)
		? (JSON.parse(readFileSync(DESCRIPTIONS_FILE, 'utf8')).photos as Record<string, Description>)
		: {};
	return descriptions[url];
};

// data/icon-images.json entries, written by classify-icons.ts.
export type IconKind = 'icon' | 'social' | 'logo' | 'number' | 'photo' | 'ornament' | 'other';
export type IconShape = 'none' | 'circle' | 'square' | 'rounded';
export type IconImage = {
	kind: IconKind;
	depicts: string;
	shape?: IconShape;
	glyph?: string; // Color the symbol is drawn in.
	fill?: string; // Color of the circle or tile behind it.
	scale?: number; // The symbol's size as a share of the image's longer side.
};

const ICONS_FILE = path.join(process.cwd(), 'data', 'icon-images.json');
let iconImages: Record<string, IconImage> | null = null;

// Shown size when the block doesn't set one in px: the file's own, within reason.
const MAX_ICON = 96;
const MIN_ICON = 16;

// Symbols that mean the same in any business keep their icon; the rest are
// picked for the new copy.
const FIXED_ICONS: [RegExp, string][] = [
	[/^check( ?mark)?$/, 'check-solid'],
	[/quot/, 'quote-left-solid'],
	[/^(right )?arrow$/, 'arrow-right-solid'],
	[/^play( button)?$/, 'play-solid'],
	[/^star( rating)?$/, 'star-solid'],
];

// Image blocks, and headings drawing an icon as their background.
export const takesIcon = (image: ImageSlot) => image.kind === 'image' || image.block === 'blockart/heading';

// Undefined for images that aren't plain pictograms (or not classified yet).
export const iconOf = (image: ImageSlot): ImageIcon | undefined => {
	iconImages ??= existsSync(ICONS_FILE) ? JSON.parse(readFileSync(ICONS_FILE, 'utf8')).images : {};
	const entry = iconImages![image.url];
	if (entry?.kind !== 'icon' || !entry.glyph) return undefined;
	const shown = Math.max(MIN_ICON, image.displayWidth ?? Math.min(image.width ?? MAX_ICON, MAX_ICON));
	const fixed = FIXED_ICONS.find(([test]) => test.test(entry.depicts.toLowerCase()))?.[1];
	return {
		depicts: entry.depicts,
		glyph: entry.glyph,
		size: Math.max(12, Math.round(shown * (entry.scale ?? 0.6))),
		...(entry.fill && entry.shape && entry.shape !== 'none' ? { shape: { kind: entry.shape, fill: entry.fill, size: shown } } : {}),
		...(fixed ? { fixed } : {}),
	};
};

const TONES_FILE = path.join(process.cwd(), '.cache', 'image-tones.json');
let tones: Record<string, Tone | null> | null = null;

// Brightness grid and color of a photo, so replacements can match it. Null
// when the file can't be downloaded or decoded.
export const photoTone = async (url: string): Promise<Tone | null> => {
	tones ??= !refresh && existsSync(TONES_FILE) ? JSON.parse(readFileSync(TONES_FILE, 'utf8')) : {};
	if (url in tones!) return tones![url] ?? null;
	try {
		tones![url] = await toneOf(await download(url));
	} catch {
		tones![url] = null;
	}
	return tones![url] ?? null;
};

export const saveToneCache = async () => {
	if (!tones) return;
	await mkdir(path.dirname(TONES_FILE), { recursive: true });
	await writeFile(TONES_FILE, JSON.stringify(tones));
};

export const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index] as T);
		}
	});
	await Promise.all(workers);
	return results;
};
