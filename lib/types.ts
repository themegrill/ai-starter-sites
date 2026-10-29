// Types for the "Build with AI" flow. Shapes mirror the frontend <-> backend
// API contract (AI_STARTER_SITES_KB.md §6) so the mock and live clients are
// interchangeable.

export type AiTone = 'friendly' | 'professional' | 'bold' | 'elegant' | 'playful';

export type AiPageSlug = 'home' | 'about' | 'services' | 'contact' | 'blog';

export type GenerateRequest = {
	brandName: string;
	description: string;
	niche: string; // 'auto' or a niche slug.
	tone: AiTone;
	language: string;
	pages: AiPageSlug[];
	// Set once the user picked a design: build from it, reusing the brief read
	// for the designs list.
	demoSlug?: string;
	briefId?: string;
	// #rrggbb. The rest of the colors follow it; unset keeps the demo's own.
	primaryColor?: string;
};

// How close a design is to the business, for grouping the designs list.
export type DesignMatch = 'best' | 'related' | 'other';

export type DesignOption = DemoSummary & { demoUrl: string; premium: boolean; match: DesignMatch };

export type DesignsResponse = { briefId: string; designs: DesignOption[] };

export type DemoSummary = {
	slug: string;
	name: string;
	thumbnail: string;
	// The demo's own primary: the color picker's starting value.
	primaryColor?: string;
};

export type BrandPalette = {
	primary: string;
	secondary: string;
	accent: string;
	text: string;
	background: string;
};

export type BrandKit = {
	siteTitle: string;
	tagline: string;
	palette: BrandPalette;
	fonts: { heading: string; body: string };
};

export type ImageSlot = {
	url: string;
	alt: string;
	credit: string;
	alternatives: string[];
	// Background photos brighter or darker than the demo's: photo URL => overlay
	// color the importer adds so the demo's text stays readable.
	overlays?: Record<string, string>;
};

// A pictogram swapped for a BlockArt icon: the icon block's name, colors and sizes.
export type IconSlot = {
	icon: string; // BlockArt icon name, e.g. "paw-solid".
	color: string;
	size: number; // px
	shape?: { color: string; radius: number; padding: number }; // radius in %, padding in px
};

export type SlotValue = string | ImageSlot | IconSlot;

export type Section = {
	id: string;
	type: string;
	slots: Record<string, SlotValue>;
	// Optional extras for the preview UI: the section's first heading, and
	// what each text slot is (heading level, paragraph, button...).
	title?: string;
	kinds?: Record<string, string>;
	// Text kept as designed (stats, prices, contact details), for context.
	fixed?: string[];
	index?: number; // Position on the demo page, for putting restored sections back in order.
};

// A section group left out because it doesn't fit the business. `sections`
// still hold the template copy; restoring one regenerates its text first.
export type RemovedGroup = {
	groupId: string;
	title: string;
	reason: string;
	sections: Section[];
	restored?: boolean; // Set by the plugin when the user brings it back.
};

export type GeneratedPage = {
	slug: string;
	title: string;
	sections: Section[];
	removed?: RemovedGroup[];
};

export type GenerationPackage = {
	id: string;
	demo: DemoSummary;
	alternatives: DemoSummary[];
	brand: BrandKit;
	pages: GeneratedPage[];
	importPackage: Record<string, unknown>;
	// Things the user should know, e.g. a requested page the design lacks.
	notes?: string[];
	// The demo's WooCommerce products, renamed and re-photographed for the business.
	products?: GeneratedProduct[];
};

export type GeneratedProduct = {
	demoId: number; // Product post ID in the demo; the importer maps it to the imported product.
	name: string;
	description: string;
	image?: ImageSlot;
};

export type RegenerateSectionRequest = {
	generationId: string;
	page: string;
	sectionId: string;
	instruction?: string;
};

export type SwitchDemoRequest = {
	generationId: string;
	demoSlug: string;
	// The color the user has now, if they changed it after generating.
	primaryColor?: string;
};

// The generated page to render on the live demo page. `removed`: group ids
// left out.
export type PreviewRequest = {
	demoSlug: string;
	page: string;
	brand: BrandKit;
	sections: { id: string; slots: Record<string, SlotValue> }[];
	removed: string[];
	products: { demoId: number; name: string; image?: string }[];
};

export type ColorMapRequest = {
	demoSlug: string;
	primaryColor: string;
};

export type GenerationStep =
	| 'understanding_brand'
	| 'picking_design'
	| 'writing_copy'
	| 'finding_images'
	| 'assembling';

export type GenerationProgress = {
	step: GenerationStep;
	progress: number; // 0..1
};

export type AiErrorCode =
	| 'RATE_LIMITED'
	| 'INVALID_INPUT'
	| 'GENERATION_FAILED'
	| 'UNAUTHORIZED'
	| 'NETWORK_ERROR'
	| 'INVALID_RESPONSE'
	| 'CANCELLED';

export type AiErrorPayload = {
	error: {
		code: AiErrorCode;
		message: string;
		retryAfter?: number;
	};
};

export const isImageSlot = (value: SlotValue | undefined): value is ImageSlot =>
	typeof value === 'object' && value !== null && 'url' in value;

export const isIconSlot = (value: SlotValue | undefined): value is IconSlot =>
	typeof value === 'object' && value !== null && 'icon' in value;
