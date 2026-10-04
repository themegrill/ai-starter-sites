// Demo manifests: a machine-readable description of every editable slot in a
// Zakra + BlockArt demo. Built offline by `pnpm manifests` from the live demo
// exports, committed under data/manifests/, and read by the generate pipeline.

export const MANIFEST_VERSION = 1;

export type PageType = 'home' | 'about' | 'services' | 'contact' | 'blog' | 'other';

export type TextSlotKind =
	| 'heading'
	| 'paragraph'
	| 'button'
	| 'list-item'
	| 'name'
	| 'role'
	| 'question'
	| 'answer'
	| 'caption'
	| 'overlay';

// Why a text slot is kept as-is instead of being rewritten.
export type LockReason = 'symbol' | 'contact' | 'number';

export type TextSlot = {
	id: string; // `${blockId}:${attr}`, unique within a page.
	// BlockArt clientId, or `core-<path>` for core blocks (which have none).
	// Copy-pasted blocks can share a clientId, so repeats get a ~n suffix.
	blockId: string;
	// The block's index among named blocks at each level, e.g. "3.0.2". Always
	// unique in a page; the importer finds blocks by this.
	path: string;
	block: string; // e.g. blockart/heading
	// Attribute path holding the text, e.g. "text" or "teamName". "@html:<el>"
	// means the text is the inner HTML of that element in the saved markup.
	attr: string;
	kind: TextSlotKind;
	tag?: string; // h1-h6 for headings.
	text: string; // Plain text: tags stripped, entities decoded.
	rich: boolean; // Original value contains inline HTML (<strong>, <br>...).
	words: number;
	minWords: number;
	maxWords: number;
	// The text is also baked into the block's saved HTML, so applying a new
	// value must replace it there too or the editor flags the block invalid.
	inHtml: boolean;
	placeholder: boolean; // Original copy is lorem ipsum.
	locked?: LockReason;
};

export type Orientation = 'landscape' | 'portrait' | 'square';

export type ImageSlot = {
	id: string;
	blockId: string;
	path: string;
	block: string;
	attr: string; // e.g. image.url or background.image.image.url
	kind: 'image' | 'background';
	url: string;
	width?: number;
	height?: number;
	orientation?: Orientation;
	// Icons, logos and other small artwork: not swapped for stock photos.
	decorative: boolean;
};

export type SectionRole =
	| 'hero'
	| 'features'
	| 'content'
	| 'testimonials'
	| 'team'
	| 'faq'
	| 'gallery'
	| 'cta'
	| 'contact'
	| 'pricing'
	| 'dynamic';

export type ManifestSection = {
	id: string; // clientId of the top-level block.
	index: number;
	role: SectionRole; // Heuristic hint for prompts and the preview UI.
	title?: string; // First heading, for humans and prompts.
	slots: TextSlot[];
	images: ImageSlot[];
	// Blocks rendered from plugin data (products, courses, forms); no copy to write.
	dynamicBlocks?: string[];
};

export type ManifestPage = {
	slug: string;
	title: string;
	type: PageType;
	sourceUrl: string;
	sections: ManifestSection[];
};

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'text' | 'background' | 'muted';

export type DemoColor = {
	hex: string; // Normalised #rrggbb.
	count: number;
	group: 'brand' | 'neutral';
	role: ColorRole;
	// For brand colors: the most-used color in the same hue cluster. A new
	// palette maps base -> palette[role] and shifts shades by the same lightness.
	base?: string;
	lightnessDelta?: number;
};

export type DemoManifest = {
	version: number;
	slug: string;
	name: string;
	theme: 'zakra';
	premium: boolean;
	previewImage: string;
	demoUrl: string;
	niches: string[];
	keywords: string[];
	plugins: string[];
	brand: {
		colors: DemoColor[];
		fonts: {
			heading: string;
			body: string;
			// Every family the blocks use, and which brand font replaces it.
			map: Record<string, 'heading' | 'body'>;
		};
	};
	pages: ManifestPage[];
	stats: {
		sections: number;
		textSlots: number;
		editableSlots: number;
		images: number;
		swappableImages: number;
		words: number;
	};
	builtAt: string;
};

// Small summary of every manifest, used for demo picking without loading all pages.
export type DemoCatalogEntry = Pick<
	DemoManifest,
	'slug' | 'name' | 'premium' | 'previewImage' | 'niches' | 'keywords' | 'stats'
> & { pageTypes: PageType[] };
