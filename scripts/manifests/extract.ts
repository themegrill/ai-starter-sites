import { parse } from '@wordpress/block-serialization-default-parser';
import {
	ImageSlot,
	ManifestSection,
	PageType,
	SectionRole,
	TextSlot,
	TextSlotKind,
} from '../../lib/demos/types';
import { normalizeColor } from './colors';
import { countWords, hasMarkup, isPlaceholderCopy, lockReason, toPlainText, wordLimits } from './text';

type Block = ReturnType<typeof parse>[number];

// Where each BlockArt block keeps its editable text. Found by surveying the
// attributes of every block in the demos; extend when a new block shows up
// in the "unmapped text" warnings.
const TEXT_ATTRS: Record<string, { attr: string; kind: TextSlotKind }[]> = {
	'blockart/heading': [{ attr: 'text', kind: 'heading' }],
	'blockart/paragraph': [{ attr: 'text', kind: 'paragraph' }],
	'blockart/button-inner': [{ attr: 'text', kind: 'button' }],
	'blockart/icon-list-item': [{ attr: 'text', kind: 'list-item' }],
	'blockart/team': [
		{ attr: 'teamName', kind: 'name' },
		{ attr: 'teamDesignation', kind: 'role' },
	],
	'blockart/faq-inner': [
		{ attr: 'question', kind: 'question' },
		{ attr: 'answer', kind: 'answer' },
	],
	'blockart/image': [
		{ attr: 'caption', kind: 'caption' },
		{ attr: 'overlayContent', kind: 'overlay' },
	],
};

const IMAGE_ATTRS: Record<string, string[]> = {
	'blockart/image': ['image.url'],
	'blockart/team': ['image.url'],
	'blockart/modal': ['image.url'],
};
const BACKGROUND_ATTR = 'background.image.image.url';

// Blocks whose content comes from plugin data, not from copy in the markup.
const DYNAMIC_BLOCK = /^(woocommerce|masteriyo|everest-forms|user-registration)\/|^core\/(shortcode|latest-posts|query)$/;

const attrsOf = (block: Block) => (block.attrs ?? {}) as Record<string, unknown>;

const getPath = (obj: unknown, path: string): unknown =>
	path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), obj);

const walk = (block: Block, visit: (block: Block) => void) => {
	if (block.blockName) visit(block);
	block.innerBlocks.forEach((inner) => walk(inner, visit));
};

export const pageTypeOf = (slug: string): PageType => {
	if (/^home/.test(slug)) return 'home';
	if (/about/.test(slug)) return 'about';
	if (/contact/.test(slug)) return 'contact';
	if (/blog|news/.test(slug)) return 'blog';
	if (/service|class|course|propert|program|menu|treatment|offer|portfolio|project/.test(slug)) return 'services';
	return 'other';
};

export type PageScan = {
	sections: ManifestSection[];
	// Block names per section id, for role detection after images are measured.
	sectionBlocks: Map<string, Set<string>>;
	colors: string[]; // Every color value used, normalised (repeats kept for counting).
	fonts: { family: string; block: string }[];
	warnings: string[];
};

const textSlotsOf = (block: Block): TextSlot[] => {
	const blockId = attrsOf(block).clientId as string;
	const slots: TextSlot[] = [];

	for (const { attr, kind } of TEXT_ATTRS[block.blockName ?? ''] ?? []) {
		const raw = getPath(attrsOf(block), attr);
		if (typeof raw !== 'string' || !raw.trim()) continue;

		const text = toPlainText(raw);
		if (!text) continue;

		const words = countWords(text);
		const locked = lockReason(text);
		slots.push({
			id: `${blockId}:${attr}`,
			blockId,
			block: block.blockName!,
			attr,
			kind,
			...(kind === 'heading' ? { tag: (attrsOf(block).markup as string) || 'h2' } : {}),
			text,
			rich: hasMarkup(raw),
			words,
			...wordLimits(words),
			inHtml: block.innerHTML.includes(raw) || block.innerHTML.includes(text),
			placeholder: isPlaceholderCopy(text),
			...(locked ? { locked } : {}),
		});
	}
	return slots;
};

const imageSlotsOf = (block: Block): ImageSlot[] => {
	const blockId = attrsOf(block).clientId as string;
	const found: { attr: string; kind: ImageSlot['kind']; url: string }[] = [];

	for (const attr of IMAGE_ATTRS[block.blockName ?? ''] ?? []) {
		const url = getPath(attrsOf(block), attr);
		if (typeof url === 'string' && url) found.push({ attr, kind: 'image', url });
	}
	const background = getPath(attrsOf(block), BACKGROUND_ATTR);
	if (typeof background === 'string' && background) {
		found.push({ attr: BACKGROUND_ATTR, kind: 'background', url: background });
	}
	// core/image keeps its URL only in the saved HTML.
	if (block.blockName === 'core/image') {
		const src = block.innerHTML.match(/<img[^>]+src="([^"]+)"/)?.[1];
		if (src) found.push({ attr: '@html:img', kind: 'image', url: src });
	}

	return found.map(({ attr, kind, url }) => ({
		id: `${blockId ?? block.blockName}:${attr}`,
		blockId: blockId ?? '',
		block: block.blockName!,
		attr,
		kind,
		url,
		decorative: false, // Filled in once the image size is known.
	}));
};

const collectColors = (value: unknown, out: string[]) => {
	if (typeof value === 'string') {
		if (/^(#[0-9a-f]{3,8}|rgba?\()/i.test(value.trim())) {
			const hex = normalizeColor(value);
			if (hex) out.push(hex);
		}
	} else if (value && typeof value === 'object') {
		Object.values(value).forEach((v) => collectColors(v, out));
	}
};

// Demos often put a section's heading in its own row above a grid (e.g.
// "Meet Our Team" then the cards), so the header row's title counts too.
const isHeaderOnly = (section: ManifestSection) =>
	section.slots.length <= 3 && !section.images.some((i) => !i.decorative) && !!section.title;

const TEAM = /\b(team|agents?|trainers?|coaches|instructors?|experts?|staff|doctors?|dentists?|teachers?)\b/;

const roleOf = (section: ManifestSection, blocks: Set<string>, previous?: ManifestSection): SectionRole => {
	const { slots, images, index, dynamicBlocks } = section;
	const dynamic = !!dynamicBlocks?.length;
	const context = previous && isHeaderOnly(previous) ? `${previous.title} ` : '';
	const text = (context + slots.map((s) => s.text).join(' ')).toLowerCase();
	const photos = images.filter((i) => !i.decorative).length;
	const words = slots.reduce((sum, s) => sum + s.words, 0);
	const headings = slots.filter((s) => s.kind === 'heading');

	if (index === 0 && !dynamic) return 'hero';
	if (blocks.has('blockart/faq')) return 'faq';
	if (blocks.has('blockart/team')) return 'team';
	if (dynamic && words < 40) return 'dynamic';
	if (/testimonial|what (our|people|clients|customers|patients)|(customers?|clients?|patients?) (say|talk)|reviews?\b/.test(text) || headings.some((h) => h.locked === 'symbol' && /["“”]/.test(h.text)))
		return 'testimonials';
	if (TEAM.test(text.slice(0, 80)) && photos >= 2) return 'team';
	if (/pricing|per month|\/\s?mo\b|membership plan|choose (a|your) plan/.test(text)) return 'pricing';
	if (/contact|get in touch|reach us|visit us/.test(text) && slots.some((s) => s.locked === 'contact')) return 'contact';
	if (photos >= 4 && words < 30) return 'gallery';
	if (slots.some((s) => s.kind === 'button') && slots.length <= 4) return 'cta';
	if (headings.filter((h) => h.tag && /h[3-6]/.test(h.tag)).length >= 3) return 'features';
	return 'content';
};

export const scanPage = (content: string, pageSlug: string): PageScan => {
	const scan: PageScan = { sections: [], sectionBlocks: new Map(), colors: [], fonts: [], warnings: [] };

	parse(content)
		.filter((block) => block.blockName)
		.forEach((top, index) => {
			const slots: TextSlot[] = [];
			const images: ImageSlot[] = [];
			const blockNames = new Set<string>();
			const dynamicBlocks = new Set<string>();

			walk(top, (block) => {
				const name = block.blockName!;
				blockNames.add(name);
				if (DYNAMIC_BLOCK.test(name)) dynamicBlocks.add(name);

				collectColors(attrsOf(block), scan.colors);
				const family = getPath(attrsOf(block), 'typography.family');
				if (typeof family === 'string' && family && family.toLowerCase() !== 'default') {
					scan.fonts.push({ family, block: name });
				}

				if (name.startsWith('blockart/') && !attrsOf(block).clientId) {
					scan.warnings.push(`${pageSlug}: ${name} has no clientId, skipped`);
					return;
				}
				slots.push(...textSlotsOf(block));
				images.push(...imageSlotsOf(block));

				// Flag prose-like attributes on blocks we don't map yet.
				if (name.startsWith('blockart/') && !TEXT_ATTRS[name]) {
					for (const [key, value] of Object.entries(attrsOf(block))) {
						if (typeof value === 'string' && countWords(toPlainText(value)) >= 2 && !/^https?:|^#|^rgba?\(/.test(value)) {
							scan.warnings.push(`${pageSlug}: unmapped text in ${name}.${key}: "${toPlainText(value).slice(0, 50)}"`);
						}
					}
				}
			});

			if (!slots.length && !images.length && !dynamicBlocks.size) return;

			const id = (attrsOf(top).clientId as string) ?? `top-${index}`;
			const firstHeading = slots.find((s) => s.kind === 'heading' && !s.locked);
			scan.sectionBlocks.set(id, blockNames);
			scan.sections.push({
				id,
				index: scan.sections.length,
				role: 'content', // Set by assignRoles() once images are measured.
				...(firstHeading ? { title: firstHeading.text } : {}),
				slots,
				images,
				...(dynamicBlocks.size ? { dynamicBlocks: [...dynamicBlocks] } : {}),
			});
		});

	return scan;
};

// Runs once image sizes are known: drops sections with nothing to rewrite or
// swap (logo rows, spacers), then labels the rest.
export const assignRoles = (scan: PageScan) => {
	scan.sections = scan.sections.filter(
		(s) => s.slots.some((slot) => !slot.locked) || s.images.some((i) => !i.decorative) || s.dynamicBlocks,
	);
	scan.sections.forEach((section, index) => {
		section.index = index;
		section.role = roleOf(section, scan.sectionBlocks.get(section.id) ?? new Set(), scan.sections[index - 1]);
	});
};
