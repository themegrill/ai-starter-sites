// Step 2: choose the demo to build from. Deterministic scoring, no LLM.
import { DEMO_CATALOG, DEMO_MANIFESTS } from '../../data/manifests';
import { DemoCatalogEntry, DemoManifest } from '../demos/types';
import { GenerateRequest } from '../types';
import { Brief } from './brief';

const FALLBACK_DEMO = 'agency-03';

// The plugin's niche dropdown values, as catalog niches.
const REQUEST_NICHES: Record<string, string> = {
	food: 'food',
	agency: 'agency',
	fitness: 'fitness',
	education: 'education',
	portfolio: 'agency',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only free demos for now.
export const availableDemos = (): DemoCatalogEntry[] => DEMO_CATALOG.filter((d) => !d.premium);

export const getManifest = (slug: string): DemoManifest | undefined => {
	const manifest = DEMO_MANIFESTS[slug];
	return manifest && !manifest.premium ? manifest : undefined;
};

export const rankDemos = (request: GenerateRequest, brief: Brief) => {
	const requestNiche = REQUEST_NICHES[request.niche];
	const text = [request.brandName, request.description, brief.businessType, brief.summary, ...brief.offerings]
		.join(' ')
		.toLowerCase();

	return availableDemos()
		.map((demo, order) => {
			let score = 0;
			if (requestNiche && demo.niches.includes(requestNiche)) score += 10;
			if (demo.niches.includes(brief.niche)) score += 6;
			score += demo.keywords.filter((k) => new RegExp(`\\b${escape(k)}`).test(text)).length * 2;
			// Small nudge toward demos that have the pages the user asked for.
			score += request.pages.filter((p) => demo.pageTypes.includes(p)).length * 0.25;
			return { demo, score, order };
		})
		.sort((a, b) => b.score - a.score || a.order - b.order);
};

export const pickDemo = (request: GenerateRequest, brief: Brief) => {
	const ranked = rankDemos(request, brief);
	const best = ranked[0];
	const chosen = best && best.score >= 2 ? best.demo : availableDemos().find((d) => d.slug === FALLBACK_DEMO) ?? best?.demo;
	if (!chosen) {
		throw new Error('No demos available');
	}
	const alternatives = ranked.map((r) => r.demo).filter((d) => d.slug !== chosen.slug).slice(0, 3);
	return { demo: getManifest(chosen.slug)!, alternatives };
};
