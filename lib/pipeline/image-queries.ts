// Step 5a: one LLM call turns each section's photos into a stock photo search
// for this business, from the section's role and new heading and what the
// demo's photos show (data/photo-descriptions.json). A team section of
// headshots becomes "baker" (tag: baker), not a generic bakery keyword.
import { ImageSlot as ManifestImage, ManifestPage, ManifestSection, PhotoSubject } from '../demos/types';
import { getLlm, LlmUsage } from '../llm';
import { GenerateRequest } from '../types';
import { Brief } from './brief';
import { CopyResult } from './copy';

// Photos of one subject in one section, searched together so they match.
export type PhotoGroup = {
	key: string;
	subject: PhotoSubject;
	section: ManifestSection;
	heading: string;
	images: ManifestImage[];
};

// `tags`: words a matching photo has among its Pixabay tags. Pixabay's search
// is loose ("baker portrait" also finds babies), so hits with one rank first.
export type PhotoQuery = { query: string; tags?: string[] };

const MAX_DESCRIPTIONS = 3;

const SYSTEM = `You pick stock photos for a website built from a template. For each photo group, write a search for a free stock photo site (Pixabay) that finds photos of the same kind for this business.
- query: 1-3 plain English words, the main subject first. Short searches work best: "baker", "gardener man", "croissant", "bakery interior".
- tags: 1-3 lowercase single words, comma-separated, a matching photo is certain to be tagged with: the job or the thing itself and close synonyms ("baker, pastry chef" is wrong, use "baker"; "landscaper, gardener"; "croissant"). Never a generic word like "owner", "family", "team", "view" or "interior".
- Keep what the template photo is: a headshot stays one person, a group stays people, a room stays a place, a product stays an object. Swap in this business's people, places and things.
- Team photos: the person's job ("baker", "gardener woman").
- Testimonial photos are customers, never staff: "smiling woman", "smiling man", "happy couple" (tags: "woman", "man" or "couple").
- Never a brand name, a place name or abstract words like "success" or "quality".`;

// Too broad to tell a matching photo from any other.
const GENERIC_TAGS = new Set('family team owner view interior people person photo portrait happy smiling business'.split(' '));

// Subject when the manifest has no description: by section role.
const subjectFor = (image: ManifestImage, section: ManifestSection): PhotoSubject =>
	image.subject ?? (section.role === 'team' || section.role === 'testimonials' ? 'person' : 'place');

export const photoGroups = (pages: ManifestPage[], copy: CopyResult): PhotoGroup[] => {
	const groups = new Map<string, PhotoGroup>();
	for (const page of pages) {
		for (const section of page.sections) {
			const titleSlot = section.slots.find((s) => s.text === section.title);
			const heading = (titleSlot && copy[page.slug]?.[titleSlot.id]) ?? section.title ?? '';
			for (const image of section.images.filter((i) => !i.decorative)) {
				const subject = subjectFor(image, section);
				// Sections repeated across pages (a team on home and about) share a group.
				const key = `${section.id}:${subject}`;
				const group = groups.get(key) ?? { key, subject, section, heading, images: [] };
				if (!group.images.some((i) => i.url === image.url)) group.images.push(image);
				groups.set(key, group);
			}
		}
	}
	return [...groups.values()];
};

// Used when the LLM call fails.
export const fallbackQuery = (group: PhotoGroup, brief: Brief): PhotoQuery => {
	if (group.section.role === 'testimonials') return { query: 'smiling woman', tags: ['woman'] };
	if (group.subject === 'person' || group.subject === 'group') return { query: `${brief.businessType} people` };
	return { query: brief.imageKeywords[0] ?? brief.businessType };
};

export const planPhotoQueries = async (
	ctx: { request: GenerateRequest; brief: Brief },
	groups: PhotoGroup[],
	signal?: AbortSignal,
): Promise<{ queries: Map<string, PhotoQuery>; usage: LlmUsage }> => {
	const { request, brief } = ctx;
	const keys = new Map(groups.map((g, i) => [g, `q${i + 1}`]));
	const lines = [
		`Business: ${request.brandName}, a ${brief.businessType}. ${brief.summary}`,
		`Offerings: ${brief.offerings.join('; ')}`,
		`Photo ideas: ${brief.imageKeywords.join(', ')}`,
		'',
		...groups.map((g) => {
			const shown = g.images
				.map((i) => i.description)
				.filter(Boolean)
				.slice(0, MAX_DESCRIPTIONS);
			const heading = g.heading ? ` "${g.heading}"` : '';
			return `${keys.get(g)} | ${g.section.role} section${heading} | ${g.images.length} ${g.subject} photo(s)${shown.length ? ` | template photos: ${shown.join('; ')}` : ''}`;
		}),
	];

	const { data, usage } = await getLlm().json<Record<string, { query?: string; tags?: string }>>({
		name: 'photo_queries',
		system: SYSTEM,
		user: lines.join('\n'),
		schema: {
			type: 'object',
			properties: Object.fromEntries(
				[...keys.values()].map((k) => [
					k,
					{
						type: 'object',
						properties: { query: { type: 'string' }, tags: { type: 'string' } },
						required: ['query', 'tags'],
						additionalProperties: false,
					},
				]),
			),
			required: [...keys.values()],
			additionalProperties: false,
		},
		maxTokens: 1500 + groups.length * 30,
		temperature: 0.2,
		signal,
	});

	const tidy = (value: unknown) =>
		String(value ?? '')
			.replace(/["“”]/g, '')
			.trim()
			.slice(0, 100);
	const queries = new Map<string, PhotoQuery>();
	for (const group of groups) {
		const answer = data[keys.get(group)!];
		const query = tidy(answer?.query);
		const words = (value: unknown) =>
			tidy(value)
				.toLowerCase()
				.split(/[\s,]+/)
				.filter((t) => /^[a-z-]{3,}$/.test(t) && !GENERIC_TAGS.has(t));
		// No usable tag: the query's own words are the next best filter.
		const tags = [...new Set([...words(answer?.tags), ...(words(answer?.tags).length ? [] : words(query))])].slice(0, 3);
		queries.set(group.key, query ? { query, ...(tags.length ? { tags } : {}) } : fallbackQuery(group, brief));
	}
	return { queries, usage };
};
