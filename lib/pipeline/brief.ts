// Step 1: turn the user's free-text description into a structured brief that
// drives demo picking and every copywriting call.
import { DEMO_CATALOG } from '../../data/manifests';
import { getLlm, LlmUsage } from '../llm';
import { GenerateRequest } from '../types';
import { languageName } from './language';

export type Brief = {
	businessType: string; // e.g. "family bakery"
	niche: string; // One of the catalog niches, or "other".
	summary: string; // One sentence about the business, in English.
	audience: string;
	location: string | null;
	offerings: string[];
	tagline: string; // In the site language.
	imageKeywords: string[]; // English stock-photo search terms.
};

export const catalogNiches = () => [...new Set(DEMO_CATALOG.flatMap((d) => d.niches))].sort();

const schema = () => ({
	type: 'object',
	properties: {
		businessType: { type: 'string', description: 'Short noun phrase, e.g. "family bakery".' },
		niche: { type: 'string', enum: [...catalogNiches(), 'other'] },
		summary: { type: 'string' },
		audience: { type: 'string' },
		location: { type: ['string', 'null'] },
		offerings: { type: 'array', items: { type: 'string' } },
		tagline: { type: 'string' },
		imageKeywords: { type: 'array', items: { type: 'string' } },
	},
	required: ['businessType', 'niche', 'summary', 'audience', 'location', 'offerings', 'tagline', 'imageKeywords'],
	additionalProperties: false,
});

const SYSTEM = `You analyse a short description of a business or project for a website builder.
Extract only what the description states or clearly implies. Never invent names, prices, awards or statistics.
- niche: the closest value from the allowed list; "other" only if nothing fits.
- summary: one plain sentence in English.
- audience: who the site is for, a few words.
- location: city/region/country if mentioned, else null.
- offerings: 3-6 short items the business provides (inferred from the type of business if not listed).
- tagline: a short, memorable site tagline (max 7 words) in the requested language and tone.
- imageKeywords: 4-6 concrete English photo search terms (subjects you could photograph).`;

export const parseBrief = async (request: GenerateRequest, signal?: AbortSignal): Promise<{ brief: Brief; usage: LlmUsage }> => {
	const { data, usage } = await getLlm().json<Brief>({
		name: 'site_brief',
		system: SYSTEM,
		user: [
			`Brand name: ${request.brandName}`,
			`Description: ${request.description}`,
			request.niche !== 'auto' ? `The user selected the niche: ${request.niche}` : '',
			`Tone: ${request.tone}`,
			`Site language: ${languageName(request.language)}`,
		]
			.filter(Boolean)
			.join('\n'),
		schema: schema(),
		temperature: 0.3,
		maxTokens: 1500,
		signal,
	});

	return {
		brief: {
			...data,
			offerings: data.offerings.slice(0, 6),
			imageKeywords: data.imageKeywords.slice(0, 6),
			location: data.location?.trim() || null,
		},
		usage,
	};
};
