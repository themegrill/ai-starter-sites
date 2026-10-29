import { ApiError } from './errors';
import {
	AiPageSlug,
	AiTone,
	BrandPalette,
	ColorMapRequest,
	GenerateRequest,
	PreviewRequest,
	RegenerateSectionRequest,
	SwitchDemoRequest,
} from './types';

// Keep in sync with the plugin's resources/onboarding/ai/constants.ts.
export const BRAND_NAME_MAX = 60;
export const DESCRIPTION_MIN = 3;
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

const hexColor = (body: Record<string, unknown>, key: string, label = key): string => {
	const value = body[key];
	if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) return invalid(`"${label}" must be a #rrggbb color.`);
	return value.trim().toLowerCase();
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
		...(str(body, 'demoSlug', false) ? { demoSlug: str(body, 'demoSlug') } : {}),
		...(str(body, 'briefId', false) ? { briefId: str(body, 'briefId') } : {}),
		...(str(body, 'primaryColor', false) ? { primaryColor: hexColor(body, 'primaryColor') } : {}),
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
		...(str(body, 'primaryColor', false) ? { primaryColor: hexColor(body, 'primaryColor') } : {}),
	};
};

const PALETTE_KEYS: (keyof BrandPalette)[] = ['primary', 'secondary', 'accent', 'text', 'background'];

const validatePalette = (palette: unknown): BrandPalette => {
	if (!isObject(palette)) return invalid('"palette" must be an object.');
	for (const key of PALETTE_KEYS) hexColor(palette, key, `palette.${key}`);
	return Object.fromEntries(PALETTE_KEYS.map((k) => [k, (palette[k] as string).toLowerCase()])) as BrandPalette;
};

// `primaryColor`, or a whole `palette` (older plugin builds) whose primary is used.
export const validateColorMap = (body: unknown): ColorMapRequest => {
	if (!isObject(body)) return invalid('Request body must be an object.');
	return {
		demoSlug: str(body, 'demoSlug'),
		primaryColor: 'primaryColor' in body ? hexColor(body, 'primaryColor') : validatePalette(body.palette).primary,
	};
};

const FONT_NAME = /^[\w \-]{1,60}$/;

export const validatePreview = (body: unknown): PreviewRequest => {
	if (!isObject(body)) return invalid('Request body must be an object.');
	const brand = body.brand;
	if (!isObject(brand) || !isObject(brand.fonts)) return invalid('"brand" must be an object.');
	const palette = validatePalette(brand.palette);
	const fonts = brand.fonts as Record<string, unknown>;
	for (const key of ['heading', 'body']) {
		if (typeof fonts[key] !== 'string' || !FONT_NAME.test(fonts[key] as string)) invalid(`"brand.fonts.${key}" is invalid.`);
	}
	if (!Array.isArray(body.sections) || !body.sections.every((s) => isObject(s) && isObject(s.slots))) {
		return invalid('"sections" must be a list of sections.');
	}
	const removed = Array.isArray(body.removed) ? body.removed.filter((r): r is string => typeof r === 'string') : [];
	const products = (Array.isArray(body.products) ? body.products : []).flatMap((p) => {
		if (!isObject(p) || typeof p.name !== 'string' || !Number.isInteger(p.demoId)) return [];
		const image = isObject(p.image) && typeof p.image.url === 'string' && /^https:\/\//.test(p.image.url) ? p.image.url : undefined;
		return [{ demoId: p.demoId as number, name: p.name.slice(0, 60), ...(image ? { image } : {}) }];
	});
	return {
		demoSlug: str(body, 'demoSlug'),
		page: str(body, 'page'),
		brand: {
			siteTitle: str(brand, 'siteTitle').slice(0, BRAND_NAME_MAX),
			tagline: str(brand, 'tagline', false).slice(0, 200),
			palette,
			fonts: { heading: fonts.heading as string, body: fonts.body as string },
		},
		sections: (body.sections as Record<string, unknown>[]).map((s) => ({
			id: String(s.id ?? ''),
			slots: s.slots as PreviewRequest['sections'][number]['slots'],
		})),
		removed,
		products,
	};
};
