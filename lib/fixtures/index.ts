import { PAGE_ORDER } from '../validate';
import { DemoSummary, GenerateRequest, GenerationPackage, Section, SlotValue } from '../types';
import { agency } from './agency';
import { bakery } from './bakery';
import { fitness } from './fitness';
import { NicheFixture } from './helpers';

export const FIXTURES: NicheFixture[] = [bakery, agency, fitness];

// Plugin niche dropdown values that map onto a fixture with a different name.
const NICHE_ALIASES: Record<string, string> = { food: 'bakery' };

/**
 * Mimics the real pipeline's demo picking: an explicit niche wins, otherwise the
 * fixture with the most keyword hits in the description, defaulting to agency.
 */
export const pickFixture = (request: GenerateRequest): NicheFixture => {
	const niche = NICHE_ALIASES[request.niche] ?? request.niche;
	const explicit = FIXTURES.find((f) => f.niche === niche);
	if (explicit) {
		return explicit;
	}

	const text = `${request.brandName} ${request.description}`.toLowerCase();
	const scored = FIXTURES.map((fixture) => ({
		fixture,
		// Match at word starts so 'consult' hits 'consulting' but 'art' misses 'start'.
		score: fixture.keywords.filter((k) => new RegExp(`\\b${k}`).test(text)).length,
	})).sort((a, b) => b.score - a.score);

	return scored[0] && scored[0].score > 0 ? scored[0].fixture : agency;
};

export const findFixtureByDemo = (demoSlug: string): NicheFixture | undefined =>
	FIXTURES.find((f) => f.demo.slug === demoSlug || f.alternatives.some((a) => a.slug === demoSlug));

const fillBrand = (value: SlotValue, brandName: string): SlotValue =>
	typeof value === 'string' ? value.split('{brand}').join(brandName) : value;

export const fillSection = (section: Section, brandName: string): Section => ({
	...section,
	slots: Object.fromEntries(
		Object.entries(section.slots).map(([key, value]) => [key, fillBrand(value, brandName)]),
	),
});

export const buildPackage = (
	id: string,
	fixture: NicheFixture,
	request: GenerateRequest,
	demo: DemoSummary = fixture.demo,
): GenerationPackage => {
	const allDemos = [fixture.demo, ...fixture.alternatives];
	const requested = new Set(request.pages.length ? request.pages : ['home']);

	return {
		id,
		demo,
		alternatives: allDemos.filter((d) => d.slug !== demo.slug).slice(0, 3),
		brand: {
			...fixture.brand,
			siteTitle: request.brandName,
			palette: { ...fixture.brand.palette },
			fonts: { ...fixture.brand.fonts },
		},
		pages: PAGE_ORDER.filter((p) => requested.has(p)).map((p) => ({
			slug: p,
			title: fixture.pages[p].title,
			sections: fixture.pages[p].sections.map((s) => fillSection(s, request.brandName)),
		})),
		importPackage: { mock: true, demoSlug: demo.slug },
	};
};
