// Step 5: images. With a Pixabay key, each section's photos are swapped for
// stock photos found with a per-section search (see image-queries.ts);
// otherwise (or when Pixabay fails) the demo's own photos are kept, since the
// demo was already picked by niche, and its other photos of the same shape are
// offered as swaps.
import { config } from '../config';
import { DemoManifest, ImageSlot as ManifestImage, ManifestPage, ManifestSection, Orientation, Tone } from '../demos/types';
import { overlayFor, toneDistance, toneOf } from '../images/tone';
import { GenerateRequest, ImageSlot } from '../types';
import { Brief } from './brief';
import { CopyResult } from './copy';
import { fallbackQuery, photoGroups, planPhotoQueries, PhotoQuery } from './image-queries';

// The pages being built and their new copy, so photos can follow each section's heading.
export type ImageContext = { request: GenerateRequest; pages: ManifestPage[]; copy: CopyResult; signal?: AbortSignal };

export interface ImageProvider {
	readonly name: string;
	imagesFor(demo: DemoManifest, brief: Brief, context?: ImageContext): Promise<Map<ManifestImage, ImageSlot>>;
}

const MAX_ALTERNATIVES = 4;

const photoSlots = (demo: DemoManifest) =>
	demo.pages.flatMap((page) =>
		page.sections.flatMap((section) =>
			section.images.filter((i) => !i.decorative).map((image) => ({ image, section })),
		),
	);

const altText = (section: ManifestSection, brief: Brief) =>
	section.title ? `${section.title} – ${brief.businessType}` : brief.businessType;

export const demoImageProvider: ImageProvider = {
	name: 'demo',
	async imagesFor(demo, brief) {
		const photos = photoSlots(demo);
		const uniqueUrls = (list: ManifestImage[]) => [...new Set(list.map((i) => i.url))];

		const result = new Map<ManifestImage, ImageSlot>();
		for (const { image, section } of photos) {
			const sameShape = photos
				.map((p) => p.image)
				.filter((other) => other.url !== image.url && other.orientation === image.orientation);
			result.set(image, {
				url: image.url,
				alt: altText(section, brief),
				credit: '',
				alternatives: uniqueUrls(sameShape).slice(0, MAX_ALTERNATIVES),
			});
		}
		return result;
	},
};

// Pixabay: https://pixabay.com/api/docs/. Requests are capped at 100 per
// minute and results must be cached for 24 hours, so each query is fetched
// once and reused across generations.
const PIXABAY_ENDPOINT = 'https://pixabay.com/api/';
const PIXABAY_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PER_PAGE = 60;
const SEARCH_CONCURRENCY = 4;
const TONE_CONCURRENCY = 12;
// Candidates per slot whose tone is compared with the demo photo's; more for
// backgrounds and heroes, where text sits on the photo.
const TONE_CANDIDATES = 6;
const TONE_CANDIDATES_TEXT = 14;
// Score penalties next to tone distance (0 = same tone, ~0.5 = opposite).
const UNTAGGED_PENALTY = 0.25;
const SHAPE_PENALTY = 0.1;
const NO_TONE_PENALTY = 0.4;

type PixabayHit = {
	largeImageURL: string;
	previewURL: string;
	imageWidth: number;
	imageHeight: number;
	tags: string;
	user: string;
};
type Photo = { url: string; preview: string; orientation: Orientation; tags: string[]; user: string };

const searchCache = new Map<string, { photos: Photo[]; at: number }>();

// A photo for a person or group slot must show an adult, not just match the job word.
const PERSON_TAGS = new Set(
	'man men woman women person people guy lady portrait worker workers couple team customer face'.split(' '),
);
const CHILD_TAGS = new Set('baby babies newborn infant child children kid kids toddler'.split(' '));
const words = (photo: Photo) => photo.tags.flatMap((t) => t.split(' '));
const showsAdult = (photo: Photo) => words(photo).some((w) => PERSON_TAGS.has(w)) && !words(photo).some((w) => CHILD_TAGS.has(w));
// Whole tags only: "baker" matches "baker" and "bakers", not "baker street".
const hasTag = (photo: Photo, tags: string[]) => photo.tags.some((t) => tags.some((tag) => t === tag || t === `${tag}s`));

const orientationOf = (width: number, height: number): Orientation => {
	const ratio = width / height;
	if (ratio > 1.15) return 'landscape';
	if (ratio < 0.87) return 'portrait';
	return 'square';
};

const searchPixabay = async (apiKey: string, query: string): Promise<Photo[]> => {
	const key = query.toLowerCase();
	const cached = searchCache.get(key);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.photos;

	const params = new URLSearchParams({
		key: apiKey,
		q: query.slice(0, 100),
		image_type: 'photo',
		safesearch: 'true',
		order: 'popular',
		per_page: String(PER_PAGE),
	});
	const response = await fetch(`${PIXABAY_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(PIXABAY_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`Pixabay ${response.status}: ${await response.text().catch(() => '')}`);

	const body = (await response.json()) as { hits?: PixabayHit[] };
	const photos = (body.hits ?? [])
		.filter((hit) => hit.largeImageURL)
		.map((hit) => ({
			url: hit.largeImageURL,
			preview: hit.previewURL,
			orientation: orientationOf(hit.imageWidth, hit.imageHeight),
			tags: hit.tags.toLowerCase().split(/\s*,\s*/),
			user: hit.user,
		}));
	searchCache.set(key, { photos, at: Date.now() });
	return photos;
};

// Tone from Pixabay's 150px preview: enough for a 3x3 brightness grid, and fast.
const toneCache = new Map<string, Promise<Tone | undefined>>();
const photoTone = (photo: Photo) => {
	if (!toneCache.has(photo.url)) {
		toneCache.set(
			photo.url,
			fetch(photo.preview, { signal: AbortSignal.timeout(5_000) })
				.then(async (response) => (response.ok ? toneOf(new Uint8Array(await response.arrayBuffer())) : undefined))
				.catch(() => undefined),
		);
	}
	return toneCache.get(photo.url)!;
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				results[i] = await fn(items[i] as T);
			}
		}),
	);
	return results;
};

// Within a slot's top candidates, the photo whose tone best matches the demo
// photo's wins; subject (tag) and shape still count, as penalties.
const rankByTone = (
	image: ManifestImage,
	section: ManifestSection,
	ranked: Photo[],
	tagged: Set<Photo>,
	tones: Map<string, Tone | undefined>,
) => {
	if (!image.tone) return ranked;
	const window = image.kind === 'background' || section.role === 'hero' ? TONE_CANDIDATES_TEXT : TONE_CANDIDATES;
	const shape = image.orientation ?? 'landscape';
	const score = (photo: Photo) => {
		const tone = tones.get(photo.url);
		return (
			(tone ? toneDistance(image.tone!, tone) : NO_TONE_PENALTY) +
			(tagged.has(photo) ? 0 : UNTAGGED_PENALTY) +
			(photo.orientation === shape ? 0 : SHAPE_PENALTY)
		);
	};
	return [...ranked.slice(0, window).sort((a, b) => score(a) - score(b)), ...ranked.slice(window)];
};

export const createPixabayProvider = (apiKey: string): ImageProvider => ({
	name: 'pixabay',
	async imagesFor(demo, brief, context) {
		const groups = photoGroups(context?.pages ?? demo.pages, context?.copy ?? {});
		if (!groups.length) return new Map();

		let queries = new Map(groups.map((g) => [g.key, fallbackQuery(g, brief)]));
		if (context) {
			try {
				const planned = await planPhotoQueries({ request: context.request, brief }, groups, context.signal);
				queries = planned.queries;
				console.log(`[images] queries: ${planned.usage.inputTokens} in / ${planned.usage.outputTokens} out tokens, ${planned.usage.ms}ms`);
			} catch (error) {
				if (context.signal?.aborted) throw error;
				console.warn('[images] query planning failed, using fallbacks:', error instanceof Error ? error.message : error);
			}
		}

		// Each group's own query, then each tag word alone (Pixabay's most
		// reliable search), then the generic fallback, until enough hits carry a tag.
		const pools = await mapLimit(groups, SEARCH_CONCURRENCY, async (group) => {
			const { query, tags = [] } = queries.get(group.key)!;
			const searches = [...new Set([query, ...tags, fallbackQuery(group, brief).query])];
			const wanted = group.images.length + MAX_ALTERNATIVES;
			const tagged: Photo[] = [];
			const untagged: Photo[] = [];
			const seen = new Set<string>();
			const needsPerson = group.subject === 'person' || group.subject === 'group';
			for (const search of searches) {
				for (const photo of await searchPixabay(apiKey, search)) {
					if (seen.has(photo.url) || (needsPerson && !showsAdult(photo))) continue;
					seen.add(photo.url);
					(!tags.length || hasTag(photo, tags) ? tagged : untagged).push(photo);
				}
				if (tagged.length >= wanted) break;
			}
			// A stranger in a team or testimonial slot looks wrong; the demo's own headshot is the better fallback.
			return { tagged, untagged: needsPerson && tags.length ? [] : untagged };
		});

		const textOnPhoto = (image: ManifestImage, section: ManifestSection) => image.kind === 'background' || section.role === 'hero';
		const tones = new Map<string, Tone | undefined>();
		const toMeasure = groups.flatMap((group, i) => {
			const { tagged = [], untagged = [] } = pools[i] ?? {};
			const window = group.images.some((image) => textOnPhoto(image, group.section)) ? TONE_CANDIDATES_TEXT : TONE_CANDIDATES;
			return group.images.some((image) => image.tone) ? [...tagged, ...untagged].slice(0, window + group.images.length) : [];
		});
		const unique = [...new Map(toMeasure.map((p) => [p.url, p])).values()];
		await mapLimit(unique, TONE_CONCURRENCY, async (photo) => tones.set(photo.url, await photoTone(photo)));

		const used = new Set<string>();
		const byDemoUrl = new Map<string, ImageSlot>();
		const result = new Map<ManifestImage, ImageSlot>();

		groups.forEach((group, i) => {
			const { tagged = [], untagged = [] } = pools[i] ?? {};
			const needsPerson = group.subject === 'person' || group.subject === 'group';
			const unused = (list: Photo[]) => list.filter((p) => !used.has(p.url));
			// A team half stock, half demo looks broken: people sections swap all photos or none.
			if (needsPerson && unused([...tagged, ...untagged]).length < group.images.length) return;

			for (const image of group.images) {
				const shape = image.orientation ?? 'landscape';
				// The right subject beats the right shape: a cropped baker over a well-framed stranger.
				const ranked = [
					...unused(tagged).filter((p) => p.orientation === shape),
					...unused(tagged).filter((p) => p.orientation !== shape),
					...unused(untagged).filter((p) => p.orientation === shape),
					...unused(untagged).filter((p) => p.orientation !== shape),
				];
				// Out of fresh photos: repeat one, except people (the same face twice in a team looks broken).
				const fallback = ranked.length || needsPerson ? ranked : [...tagged, ...untagged];
				const [pick, ...rest] = rankByTone(image, group.section, fallback, new Set(tagged), tones);
				if (!pick) continue;

				used.add(pick.url);
				const alternatives = rest.slice(0, MAX_ALTERNATIVES);
				const overlays = Object.fromEntries(
					image.kind === 'background' && image.tone
						? [pick, ...alternatives].flatMap((p) => {
								const tone = tones.get(p.url);
								const overlay = tone && overlayFor(image.tone!, tone);
								return overlay ? [[p.url, overlay]] : [];
							})
						: [],
				);
				byDemoUrl.set(image.url, {
					url: pick.url,
					alt: altText(group.section, brief),
					credit: `Photo by ${pick.user} on Pixabay`,
					alternatives: alternatives.map((p) => p.url),
					...(Object.keys(overlays).length ? { overlays } : {}),
				});
			}
		});

		// Every slot showing the same demo photo (repeated sections) gets the same stock photo.
		for (const page of context?.pages ?? demo.pages) {
			for (const section of page.sections) {
				for (const image of section.images) {
					const value = byDemoUrl.get(image.url);
					if (value && !image.decorative) result.set(image, value);
				}
			}
		}
		return result;
	},
});

// Pixabay with the demo's photos filling any slot it couldn't, and taking
// over entirely if Pixabay is down or over its rate limit.
const withDemoFallback = (primary: ImageProvider): ImageProvider => ({
	name: primary.name,
	async imagesFor(demo, brief, context) {
		const fallback = await demoImageProvider.imagesFor(demo, brief);
		try {
			const images = await primary.imagesFor(demo, brief, context);
			for (const [slot, value] of fallback) if (!images.has(slot)) images.set(slot, value);
			return images;
		} catch (error) {
			if (context?.signal?.aborted) throw error;
			console.warn(`[images] ${primary.name} failed, using demo photos:`, error instanceof Error ? error.message : error);
			return fallback;
		}
	},
});

export const getImageProvider = (): ImageProvider =>
	config.pixabayApiKey ? withDemoFallback(createPixabayProvider(config.pixabayApiKey)) : demoImageProvider;
