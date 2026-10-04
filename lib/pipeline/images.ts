// Step 5: images. Until a stock photo API is available, the provider keeps
// the demo's own photos (already on-niche, since the demo was picked by
// niche) and offers its other photos of the same shape as swaps. A stock
// provider (Unsplash, Openverse...) implements the same interface.
import { DemoManifest, ImageSlot as ManifestImage } from '../demos/types';
import { ImageSlot } from '../types';
import { Brief } from './brief';

export interface ImageProvider {
	readonly name: string;
	imagesFor(demo: DemoManifest, brief: Brief): Promise<Map<ManifestImage, ImageSlot>>;
}

const MAX_ALTERNATIVES = 4;

export const demoImageProvider: ImageProvider = {
	name: 'demo',
	async imagesFor(demo, brief) {
		const photos = demo.pages.flatMap((page) =>
			page.sections.flatMap((section) =>
				section.images.filter((i) => !i.decorative).map((image) => ({ image, section })),
			),
		);
		const uniqueUrls = (list: ManifestImage[]) => [...new Set(list.map((i) => i.url))];

		const result = new Map<ManifestImage, ImageSlot>();
		for (const { image, section } of photos) {
			const sameShape = photos
				.map((p) => p.image)
				.filter((other) => other.url !== image.url && other.orientation === image.orientation);
			result.set(image, {
				url: image.url,
				alt: section.title ? `${section.title} – ${brief.businessType}` : brief.businessType,
				credit: '',
				alternatives: uniqueUrls(sameShape).slice(0, MAX_ALTERNATIVES),
			});
		}
		return result;
	},
};

export const getImageProvider = (): ImageProvider => demoImageProvider;
