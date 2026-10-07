import { parse } from '@wordpress/block-serialization-default-parser';
import {
	Capability,
	ImageSlot,
	ManifestGroup,
	ManifestSection,
	PageType,
	SectionFit,
	SectionRole,
	TextSlot,
	TextSlotKind,
} from '../../lib/demos/types';
import { normalizeColor } from './colors';
import { ColorContext, scanColorContext } from './contrast';
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

// `path` is the block's position in the page (e.g. "3.0.2"); core blocks have
// no clientId, so it gives them a stable id.
const walk = (block: Block, visit: (block: Block, path: string) => void, path: string) => {
	if (block.blockName) visit(block, path);
	block.innerBlocks.forEach((inner, i) => walk(inner, visit, `${path}.${i}`));
};

const blockIdOf = (block: Block, path: string) => (attrsOf(block).clientId as string | undefined) ?? `core-${path}`;

// Core blocks keep their text only in the saved HTML: the inner HTML of this element.
const CORE_TEXT: Record<string, { element: string; kind: TextSlotKind }> = {
	'core/paragraph': { element: 'p', kind: 'paragraph' },
	'core/heading': { element: 'h[1-6]', kind: 'heading' },
	'core/button': { element: 'a', kind: 'button' },
	'core/list-item': { element: 'li', kind: 'list-item' },
	'core/details': { element: 'summary', kind: 'question' },
};

export const pageTypeOf = (slug: string): PageType => {
	if (/^home/.test(slug)) return 'home';
	if (/about/.test(slug)) return 'about';
	if (/contact/.test(slug)) return 'contact';
	if (/blog|news/.test(slug)) return 'blog';
	if (/service|class|course|lesson|package|propert|program|menu|treatment|offer|practi[cs]e|area|portfolio|project/.test(slug)) return 'services';
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

const textSlotsOf = (block: Block, blockId: string, path: string): TextSlot[] => {
	const slots: TextSlot[] = [];
	const sources: { attr: string; kind: TextSlotKind; raw: unknown; tag?: string }[] = (
		TEXT_ATTRS[block.blockName ?? ''] ?? []
	).map(({ attr, kind }) => ({ attr, kind, raw: getPath(attrsOf(block), attr), tag: attrsOf(block).markup as string }));

	const core = CORE_TEXT[block.blockName ?? ''];
	if (core) {
		const match = block.innerHTML.match(new RegExp(`<(${core.element})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'i'));
		if (match?.[2]) {
			sources.push({ attr: `@html:${core.element === 'h[1-6]' ? 'h' : core.element}`, kind: core.kind, raw: match[2], tag: match[1]?.toLowerCase() });
		}
	}

	for (const { attr, kind, raw, tag } of sources) {
		if (typeof raw !== 'string' || !raw.trim()) continue;

		const text = toPlainText(raw);
		if (!text) continue;

		const words = countWords(text);
		const locked = lockReason(text);
		slots.push({
			id: `${blockId}:${attr}`,
			blockId,
			path,
			block: block.blockName!,
			attr,
			kind,
			...(kind === 'heading' ? { tag: tag || 'h2' } : {}),
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

const imageSlotsOf = (block: Block, blockId: string, path: string): ImageSlot[] => {
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
		id: `${blockId}:${attr}`,
		blockId,
		path,
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

// Titles of blog/news teasers; "Want regular news and updates" (a newsletter form) must not match.
const POSTS_TITLE = /^(our |the )?(blog|posts?|articles?|news)\b|\b(latest|recent) (posts?|articles?|news|blogs?)\b|\bblog\b/i;

const editableWords = (section: ManifestSection) =>
	section.slots.filter((s) => !s.locked).reduce((sum, s) => sum + s.words, 0);

// A row of logos with at most a heading and a line of text. Icon features
// and counters also use small images, but carry text for each one.
const isLogoStrip = (section: ManifestSection) =>
	section.images.filter((i) => i.decorative).length >= 3 &&
	section.slots.length <= 2 &&
	section.images.filter((i) => !i.decorative).length <= 1 &&
	editableWords(section) < 15;

const roleOf = (section: ManifestSection, blocks: Set<string>, previous?: ManifestSection): SectionRole => {
	const { slots, images, index, dynamicBlocks } = section;
	const dynamic = !!dynamicBlocks?.length;
	const context = previous && isHeaderOnly(previous) ? `${previous.title} ` : '';
	const text = (context + slots.map((s) => s.text).join(' ')).toLowerCase();
	const photos = images.filter((i) => !i.decorative).length;
	const words = slots.reduce((sum, s) => sum + s.words, 0);
	const headings = slots.filter((s) => s.kind === 'heading');

	if (index === 0 && !dynamic) return 'hero';
	if (isLogoStrip(section)) return 'logos';
	if (blocks.has('blockart/faq')) return 'faq';
	if (blocks.has('blockart/team')) return 'team';
	if (POSTS_TITLE.test(section.title ?? '') || (dynamic && dynamicBlocks!.every((b) => /latest-posts|query/.test(b))))
		return 'posts';
	if (dynamic && words < 40) return 'dynamic';
	if (/testimonial|what (our|people|clients|customers|patients)|(customers?|clients?|patients?) (say|talk)|reviews?\b/.test(text) || headings.some((h) => h.locked === 'symbol' && /["“”]/.test(h.text)))
		return 'testimonials';
	if (TEAM.test(text.slice(0, 80)) && photos >= 2) return 'team';
	if (/pricing|per month|\/\s?mo\b|membership plan|choose (a|your) plan/.test(text)) return 'pricing';
	// Counters ("310k", "27M+"), not prices: a menu or price list is not stats.
	const counters = slots.filter((s) => s.locked === 'number' && !/[$€£¥₹]/.test(s.text));
	if (counters.length >= 2 && !slots.some((s) => /[$€£¥₹]/.test(s.text)) && editableWords(section) < 40 && photos < 2)
		return 'stats';
	if (/contact|get in touch|reach us|visit us/.test(text) && slots.some((s) => s.locked === 'contact')) return 'contact';
	if (photos >= 4 && words < 30) return 'gallery';
	if (slots.some((s) => s.kind === 'button') && slots.length <= 4) return 'cta';
	if (headings.filter((h) => h.tag && /h[3-6]/.test(h.tag)).length >= 3) return 'features';
	return 'content';
};

export const scanPage = (content: string, pageSlug: string, colors?: { ctx: ColorContext; ink?: string }): PageScan => {
	const scan: PageScan = { sections: [], sectionBlocks: new Map(), colors: [], fonts: [], warnings: [] };
	// Copy-pasted BlockArt blocks can share a clientId; later copies get a suffix.
	const seenIds = new Map<string, number>();

	const blocks = parse(content);
	if (colors) scanColorContext(blocks, colors.ctx, colors.ink);
	blocks
		.filter((block) => block.blockName)
		.forEach((top, index) => {
			const slots: TextSlot[] = [];
			const images: ImageSlot[] = [];
			const blockNames = new Set<string>();
			const dynamicBlocks = new Set<string>();

			walk(top, (block, path) => {
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
				let blockId = blockIdOf(block, path);
				const copies = seenIds.get(blockId) ?? 0;
				seenIds.set(blockId, copies + 1);
				if (copies) blockId = `${blockId}~${copies}`;

				slots.push(...textSlotsOf(block, blockId, path));
				images.push(...imageSlotsOf(block, blockId, path));

				// Flag prose-like attributes on blocks we don't map yet.
				if (name.startsWith('blockart/') && !TEXT_ATTRS[name]) {
					for (const [key, value] of Object.entries(attrsOf(block))) {
						if (typeof value === 'string' && countWords(toPlainText(value)) >= 2 && !/^https?:|^#|^rgba?\(/.test(value)) {
							scan.warnings.push(`${pageSlug}: unmapped text in ${name}.${key}: "${toPlainText(value).slice(0, 50)}"`);
						}
					}
				}
			}, String(index));

			if (!slots.length && !images.length && !dynamicBlocks.size) return;

			const id = (attrsOf(top).clientId as string) ?? `top-${index}`;
			const firstHeading = slots.find((s) => s.kind === 'heading' && !s.locked);
			scan.sectionBlocks.set(id, blockNames);
			scan.sections.push({
				id,
				index: scan.sections.length,
				path: String(index),
				group: id, // Set by buildGroups().
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
// swap (spacers, dividers), then labels the rest. Logo strips stay so they
// can be dropped for businesses that have no clients to show.
export const assignRoles = (scan: PageScan) => {
	scan.sections = scan.sections.filter(
		(s) => s.slots.some((slot) => !slot.locked) || s.images.some((i) => !i.decorative) || s.dynamicBlocks || isLogoStrip(s),
	);
	scan.sections.forEach((section, index) => {
		section.index = index;
		section.role = roleOf(section, scan.sectionBlocks.get(section.id) ?? new Set(), scan.sections[index - 1]);
	});
};

// Body blocks an intro (heading + text only) can introduce.
const BODY_ROLES = new Set<SectionRole>(['pricing', 'gallery', 'team', 'testimonials', 'features', 'logos', 'stats', 'posts', 'dynamic']);

const isIntro = (section: ManifestSection) =>
	!!section.title &&
	section.slots.length <= 3 &&
	section.slots.every((s) => s.kind === 'heading' || s.kind === 'paragraph') &&
	!section.images.some((i) => !i.decorative) &&
	!section.dynamicBlocks;

const REQUIRES: Partial<Record<SectionRole, Capability[]>> = {
	pricing: ['pricing_plans'],
	team: ['team'],
	logos: ['client_logos'],
	stats: ['stats'],
	posts: ['blog'],
};

const fitOf = (role: SectionRole, sections: ManifestSection[], title = ''): SectionFit => {
	let requires = REQUIRES[role];
	// Only a gallery of past work is a portfolio; dish, venue or class photos suit most businesses.
	if (role === 'gallery') {
		requires = /portfolio|projects?|our work|case stud|showcase/i.test(title)
			? ['portfolio']
			: /class|course|program|session|lesson/i.test(title)
				? ['classes_schedule']
				: undefined;
	}
	if (role === 'dynamic') {
		const blocks = sections.flatMap((s) => s.dynamicBlocks ?? []);
		requires = blocks.some((b) => /^(woocommerce|masteriyo)\//.test(b)) ? ['products'] : undefined;
	}
	return requires ? { kind: 'conditional', requires } : { kind: 'core' };
};

/**
 * Groups a page's sections into the units the pipeline keeps or drops: an
 * intro followed by the body block(s) it introduces, or a single section.
 * Catalog `sectionFit` overrides replace the derived fit by group id.
 */
export const buildGroups = (sections: ManifestSection[], overrides: Record<string, SectionFit> = {}): ManifestGroup[] => {
	const groups: ManifestGroup[] = [];
	for (let i = 0; i < sections.length; ) {
		const first = sections[i]!;
		const members = [first];
		const body = sections[i + 1];
		if (i > 0 && isIntro(first) && body && BODY_ROLES.has(body.role) && !isIntro(body)) {
			members.push(body);
		}
		// Untitled rows of the same kind continue the group (a gallery or logo strip split in two rows).
		const last = members[members.length - 1]!;
		while (BODY_ROLES.has(last.role) && sections[i + members.length]?.role === last.role && !sections[i + members.length]!.title) {
			members.push(sections[i + members.length]!);
		}
		i += members.length;

		const role: SectionRole =
			first.role === 'hero' ? 'hero' : POSTS_TITLE.test(first.title ?? '') ? 'posts' : (members[1] ?? first).role;
		const from = Number(first.path);
		const to = Number(members[members.length - 1]!.path);
		const group: ManifestGroup = {
			id: first.id,
			role,
			...(first.title ? { title: first.title } : {}),
			sectionIds: members.map((s) => s.id),
			paths: Array.from({ length: to - from + 1 }, (_, k) => String(from + k)),
			fit: overrides[first.id] ?? fitOf(role, members, first.title),
		};
		members.forEach((s) => (s.group = group.id));
		groups.push(group);
	}
	return groups;
};
