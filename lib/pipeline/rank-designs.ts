// Step 2: order every design from closest to farthest for this business, for
// the user to pick from. Keyword scoring alone only finds literal matches, so
// a design named "Suffice" never surfaced for a consultant. The brief names
// neighbouring niches, and designs are grouped by niche and sector around
// them: exact matches, related niches, same sector, then farther out. No extra
// LLM call (ranking all designs that way was slow and unreliable).
import { DemoCatalogEntry } from '../demos/types';
import { DesignMatch, DesignOption, GenerateRequest } from '../types';
import { summaryOf } from './assemble';
import { Brief } from './brief';
import { rankDemos } from './pick-demo';

// A keyword or niche hit scores at least this (see rankDemos).
const STRONG_SCORE = 6;
const MIN_BEST = 2;

// Broad sectors, so designs in the business's own and neighbouring sectors come
// before unrelated ones. A design's sector is its first niche's.
const SECTORS: Record<string, string[]> = {
	'food and drink': ['bakery', 'cafe', 'coffee', 'food', 'restaurant', 'agriculture', 'farming'],
	health: ['dental', 'healthcare', 'medical', 'health', 'nutrition', 'eyewear', 'veterinary', 'pets'],
	'beauty and wellness': ['beauty', 'salon', 'spa', 'wellness', 'yoga', 'meditation', 'therapy', 'counselling', 'coaching'],
	fitness: ['fitness', 'gym', 'sports'],
	education: ['education', 'courses', 'lms', 'university', 'kids', 'childcare'],
	'professional services': ['business', 'consulting', 'finance', 'legal', 'professional-services', 'agency', 'marketing', 'startup', 'recruitment', 'jobs'],
	'home, property and trades': ['construction', 'architecture', 'home-services', 'trades', 'repair', 'cleaning', 'real-estate', 'property', 'garden', 'plants'],
	'creative and media': ['creative', 'portfolio', 'photography', 'videography', 'drones', 'music', 'entertainment', 'gaming', 'author', 'books', 'writing', 'publishing', 'membership', 'blog', 'personal'],
	'community and faith': ['nonprofit', 'charity', 'church', 'religion'],
	'retail and shops': ['shop', 'ecommerce', 'retail', 'fashion', 'furniture', 'gifts', 'antiques'],
	technology: ['technology', 'hosting'],
	'travel and events': ['travel', 'tourism', 'wedding', 'events'],
};
const SECTOR_NAMES = Object.keys(SECTORS);
const sectorOf = (demo: DemoCatalogEntry) =>
	SECTOR_NAMES.find((name) => demo.niches.some((n) => SECTORS[name]!.includes(n))) ?? 'professional services';

const GENERAL = new Set(['business', 'agency', 'consulting', 'startup', 'professional-services']);
const RELATED_MAX = 12;

export const rankDesigns = (request: GenerateRequest, brief: Brief): DesignOption[] => {
	const scored = rankDemos(request, brief);
	const score = new Map(scored.map((r) => [r.demo.slug, r.score]));
	const related = brief.relatedNiches ?? [];
	const ownSector = SECTOR_NAMES.find((name) => SECTORS[name]!.includes(brief.niche));
	const sectorOrder = [...new Set([ownSector, ...related.map((n) => SECTOR_NAMES.find((name) => SECTORS[name]!.includes(n)))])];

	// Lower tiers are closer: exact matches, related niches (closest first), the
	// business's own sector, the related niches' sectors, general business, rest.
	const tier = (demo: DemoCatalogEntry) => {
		if (score.get(demo.slug)! >= STRONG_SCORE) return 0;
		const relatedIndex = Math.min(...demo.niches.map((n) => related.indexOf(n)).filter((i) => i >= 0));
		if (Number.isFinite(relatedIndex)) return 1 + relatedIndex / 10;
		const sector = sectorOrder.indexOf(sectorOf(demo));
		if (sector >= 0) return 2 + sector / 10;
		return demo.niches.some((n) => GENERAL.has(n)) ? 3 : 4;
	};
	const order = scored
		.map((r) => r.demo)
		.sort((a, b) => tier(a) - tier(b) || score.get(b.slug)! - score.get(a.slug)!);

	const strong = order.filter((d) => tier(d) === 0).length;
	const best = Math.max(MIN_BEST, strong);
	const close = Math.min(best + RELATED_MAX, order.filter((d) => tier(d) < 3).length);
	return order.map((demo, i): DesignOption => {
		const match: DesignMatch = i < best ? 'best' : i < close ? 'related' : 'other';
		return { ...summaryOf(demo), demoUrl: demo.demoUrl, premium: demo.premium, match };
	});
};
