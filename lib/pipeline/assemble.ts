// Step 6: build the Generation Package. `pages` is what the UI shows and
// edits; `importPackage` tells the WordPress importer where each slot lives
// in the demo, so it can apply the final (edited) values.
import { DemoCatalogEntry, DemoManifest, ImageSlot as ManifestImage, ManifestPage, ManifestSection, PageType } from '../demos/types';
import { AiPageSlug, BrandKit, DemoSummary, GeneratedPage, GenerationPackage, ImageSlot, Section } from '../types';
import { buildColorMap, buildFontMap } from './brand-kit';
import { CopyResult, editableSlots } from './copy';

export const IMPORT_PACKAGE_VERSION = 1;

const PAGE_LABELS: Record<AiPageSlug, string> = {
	home: 'Home',
	about: 'About',
	services: 'Services',
	contact: 'Contact',
	blog: 'Blog',
};

export const summaryOf = (demo: DemoManifest | DemoCatalogEntry): DemoSummary => ({
	slug: demo.slug,
	name: demo.name,
	thumbnail: demo.previewImage,
});

// The demo's first page of each requested type, in the order the user listed.
export const selectPages = (demo: DemoManifest, requested: AiPageSlug[]) => {
	const pages: { type: AiPageSlug; page: ManifestPage }[] = [];
	const missing: AiPageSlug[] = [];
	for (const type of requested) {
		const page = demo.pages.find((p) => p.type === (type as PageType));
		if (page) pages.push({ type, page });
		else missing.push(type);
	}
	return { pages, missing };
};

export const buildSection = (
	section: ManifestSection,
	copy: Record<string, string>,
	images: Map<ManifestImage, ImageSlot>,
): Section => {
	const slots: Section['slots'] = {};
	const kinds: Record<string, string> = {};
	for (const slot of editableSlots(section)) {
		slots[slot.id] = copy[slot.id] ?? slot.text;
		kinds[slot.id] = slot.kind === 'heading' ? slot.tag ?? 'h2' : slot.kind;
	}
	for (const image of section.images) {
		const value = images.get(image);
		if (value) {
			slots[image.id] = value;
			kinds[image.id] = image.kind;
		}
	}
	return {
		id: section.id,
		type: section.role,
		...(section.title ? { title: copy[section.slots.find((s) => s.text === section.title)?.id ?? ''] ?? section.title } : {}),
		slots,
		kinds,
	};
};

const slotLocations = (section: ManifestSection) =>
	Object.fromEntries([
		...editableSlots(section).map((s) => [s.id, { path: s.path, block: s.block, attr: s.attr, inHtml: s.inHtml, rich: s.rich }]),
		...section.images.filter((i) => !i.decorative).map((i) => [i.id, { path: i.path, block: i.block, attr: i.attr }]),
	]);

export const assemblePackage = (args: {
	id: string;
	demo: DemoManifest;
	alternatives: DemoCatalogEntry[];
	brand: BrandKit;
	requestedPages: AiPageSlug[];
	copy: CopyResult;
	images: Map<ManifestImage, ImageSlot>;
	imageProvider: string;
}): GenerationPackage => {
	const { demo, brand, copy, images } = args;
	const { pages: selected, missing } = selectPages(demo, args.requestedPages);

	const pages: GeneratedPage[] = selected.map(({ type, page }) => ({
		slug: type,
		title: PAGE_LABELS[type],
		sections: page.sections
			.filter((s) => editableSlots(s).length || s.images.some((i) => !i.decorative))
			.map((s) => buildSection(s, copy[page.slug] ?? {}, images)),
	}));

	return {
		id: args.id,
		demo: summaryOf(demo),
		alternatives: args.alternatives.map(summaryOf),
		brand,
		pages,
		notes: missing.map((type) => `This design has no ${PAGE_LABELS[type]} page, so it was skipped.`),
		importPackage: {
			version: IMPORT_PACKAGE_VERSION,
			theme: demo.theme,
			demoSlug: demo.slug,
			imageProvider: args.imageProvider,
			pages: selected.map(({ type, page }) => ({
				slug: type,
				demoPageSlug: page.slug,
				sourceUrl: page.sourceUrl,
				slots: Object.assign({}, ...page.sections.map(slotLocations)),
			})),
			// Demo colors/fonts by role; the importer recomputes these maps from the
			// final (possibly edited) palette and fonts. Precomputed values below
			// match the generated brand kit.
			demoColors: demo.brand.colors.filter((c) => c.group === 'brand').map(({ hex, role }) => ({ hex, role })),
			demoFonts: demo.brand.fonts.map,
			colorMap: buildColorMap(demo, brand.palette),
			fontMap: buildFontMap(demo, brand.fonts),
		},
	};
};
