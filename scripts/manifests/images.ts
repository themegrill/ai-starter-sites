// Reads image dimensions from the first bytes of each file (a Range request),
// so the pipeline can match stock photos by orientation. Results are cached
// in .cache/image-sizes.json.
import { imageSize } from 'image-size';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageSlot, Orientation } from '../../lib/demos/types';
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
