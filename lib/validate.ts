import { ApiError } from './errors';
import {
	AiPageSlug,
	AiTone,
	GenerateRequest,
	RegenerateSectionRequest,
	SwitchDemoRequest,
} from './types';

// Keep in sync with the plugin's resources/onboarding/ai/constants.ts.
export const BRAND_NAME_MAX = 60;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 500;
export const INSTRUCTION_MAX = 200;

export const TONES: AiTone[] = ['friendly', 'professional', 'bold', 'elegant', 'playful'];
export const PAGE_ORDER: AiPageSlug[] = ['home', 'about', 'services', 'contact', 'blog'];

const invalid = (message: string): never => {
	throw new ApiError('INVALID_INPUT', message);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (body: Record<string, unknown>, key: string, required = true): string => {
	const value = body[key];
	if (value === undefined || value === null || value === '') {
		return required ? invalid(`"${key}" is required.`) : '';
	}
	if (typeof value !== 'string') {
		return invalid(`"${key}" must be a string.`);
	}
	return value.trim();
};

export const validateGenerate = (body: unknown): GenerateRequest => {
	if (!isObject(body)) return invalid('Request body must be an object.');

	const brandName = str(body, 'brandName');
	if (brandName.length > BRAND_NAME_MAX) invalid(`"brandName" must be at most ${BRAND_NAME_MAX} characters.`);

	const description = str(body, 'description');
	if (description.length < DESCRIPTION_MIN) invalid(`"description" must be at least ${DESCRIPTION_MIN} characters.`);
	if (description.length > DESCRIPTION_MAX) invalid(`"description" must be at most ${DESCRIPTION_MAX} characters.`);

	const tone = (str(body, 'tone', false) || 'friendly') as AiTone;
	if (!TONES.includes(tone)) invalid(`"tone" must be one of: ${TONES.join(', ')}.`);

	const rawPages = body.pages ?? ['home'];
	if (!Array.isArray(rawPages) || rawPages.some((p) => !PAGE_ORDER.includes(p as AiPageSlug))) {
		invalid(`"pages" must be an array of: ${PAGE_ORDER.join(', ')}.`);
	}
	const requested = new Set<AiPageSlug>(['home', ...(rawPages as AiPageSlug[])]);

	return {
		brandName,
		description,
		niche: (str(body, 'niche', false) || 'auto').toLowerCase(),
		tone,
		language: (str(body, 'language', false) || 'en').toLowerCase(),
		pages: PAGE_ORDER.filter((p) => requested.has(p)),
	};
};

export const validateRegenerate = (body: unknown): RegenerateSectionRequest => {
	if (!isObject(body)) return invalid('Request body must be an object.');
	const instruction = str(body, 'instruction', false);
	if (instruction.length > INSTRUCTION_MAX) invalid(`"instruction" must be at most ${INSTRUCTION_MAX} characters.`);

	return {
		generationId: str(body, 'generationId'),
		page: str(body, 'page'),
		sectionId: str(body, 'sectionId'),
		instruction,
	};
};

export const validateSwitchDemo = (body: unknown): SwitchDemoRequest => {
	if (!isObject(body)) return invalid('Request body must be an object.');
	return {
		generationId: str(body, 'generationId'),
		demoSlug: str(body, 'demoSlug'),
	};
};
