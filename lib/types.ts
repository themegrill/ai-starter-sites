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
};

export type DemoSummary = {
	slug: string;
	name: string;
	thumbnail: string;
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
};

export type SlotValue = string | ImageSlot;

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
};

export type ColorMapRequest = {
	demoSlug: string;
	palette: BrandPalette;
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
