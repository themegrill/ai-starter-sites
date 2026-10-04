// Orchestrates a generation: brief -> demo -> brand kit -> copy -> images ->
// package, reporting progress after each step.
import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors';
import { LlmUsage } from '../llm';
import { GenerateRequest, GenerationPackage, GenerationProgress, Section } from '../types';
import { assemblePackage, buildSection, selectPages } from './assemble';
import { pickBrandKit } from './brand-kit';
import { Brief, parseBrief } from './brief';
import { writeCopy, writeSectionCopy } from './copy';
import { getImageProvider } from './images';
import { availableDemos, getManifest, pickDemo, rankDemos } from './pick-demo';
import { getGeneration, saveGeneration } from './store';

export type RunOptions = { onProgress?: (p: GenerationProgress) => void; signal?: AbortSignal };

const log = (id: string, label: string, usage: LlmUsage, extra = '') =>
	console.log(`[generate] ${id} ${label}: ${usage.inputTokens} in / ${usage.outputTokens} out tokens, ${usage.ms}ms${extra}`);

const buildFromDemo = async (
	id: string,
	request: GenerateRequest,
	brief: Brief,
	demoSlug: string,
	options: RunOptions,
	brandOverride?: GenerationPackage['brand'],
) => {
	const { onProgress, signal } = options;
	const demo = getManifest(demoSlug);
	if (!demo) throw new ApiError('INVALID_INPUT', 'That design is not available.');

	const alternatives = rankDemos(request, brief)
		.map((r) => r.demo)
		.filter((d) => d.slug !== demo.slug)
		.slice(0, 3);
	const brand = brandOverride ?? pickBrandKit(demo, request.tone, request.brandName, brief);

	onProgress?.({ step: 'writing_copy', progress: 0.3 });
	const { pages } = selectPages(demo, request.pages);
	const { copy, usage, fallbacks } = await writeCopy(
		{ request, brief, demo },
		pages.map((p) => p.page),
		{
			signal,
			onBatchDone: (done, total) => onProgress?.({ step: 'writing_copy', progress: 0.3 + (done / total) * 0.5 }),
		},
	);
	log(id, `copy (${demo.slug})`, usage, fallbacks ? `, ${fallbacks} fallbacks` : '');

	onProgress?.({ step: 'finding_images', progress: 0.85 });
	const provider = getImageProvider();
	const images = await provider.imagesFor(demo, brief);

	onProgress?.({ step: 'assembling', progress: 0.95 });
	const pkg = assemblePackage({
		id,
		demo,
		alternatives,
		brand,
		requestedPages: request.pages,
		copy,
		images,
		imageProvider: provider.name,
	});
	saveGeneration(id, { request, brief, demo, pkg });
	return pkg;
};

export const runGeneration = async (request: GenerateRequest, options: RunOptions = {}): Promise<GenerationPackage> => {
	const id = `gen_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
	const started = Date.now();

	options.onProgress?.({ step: 'understanding_brand', progress: 0.05 });
	const { brief, usage } = await parseBrief(request, options.signal);
	log(id, 'brief', usage, ` niche=${brief.niche}`);

	options.onProgress?.({ step: 'picking_design', progress: 0.2 });
	const { demo } = pickDemo(request, brief);

	const pkg = await buildFromDemo(id, request, brief, demo.slug, options);
	console.log(`[generate] ${id} done in ${Date.now() - started}ms`);
	return pkg;
};

const requireGeneration = (id: string) => {
	const stored = getGeneration(id);
	if (!stored) {
		throw new ApiError('INVALID_INPUT', 'This generation has expired. Please generate your site again.');
	}
	return stored;
};

export const runSwitchDemo = async (generationId: string, demoSlug: string, options: RunOptions = {}) => {
	const stored = requireGeneration(generationId);
	if (!availableDemos().some((d) => d.slug === demoSlug)) {
		throw new ApiError('INVALID_INPUT', 'That design is not available.');
	}
	// Keep the brand kit: the user may have tuned it in the preview.
	return buildFromDemo(generationId, stored.request, stored.brief, demoSlug, options, stored.pkg.brand);
};

export const runRegenerateSection = async (
	generationId: string,
	pageSlug: string,
	sectionId: string,
	instruction = '',
	options: RunOptions = {},
): Promise<{ section: Section }> => {
	const stored = requireGeneration(generationId);
	const { pages } = selectPages(stored.demo, stored.request.pages);
	const page = pages.find((p) => p.type === pageSlug)?.page;
	const section = page?.sections.find((s) => s.id === sectionId);
	if (!page || !section) {
		throw new ApiError('INVALID_INPUT', 'That section could not be found.');
	}

	const { copy, usage } = await writeSectionCopy(
		{ request: stored.request, brief: stored.brief, demo: stored.demo },
		page,
		section,
		instruction,
		options.signal,
	);
	log(generationId, `regenerate ${pageSlug}/${sectionId}`, usage);

	// Images are unchanged; reuse what the package already has for this section.
	const current = stored.pkg.pages.find((p) => p.slug === pageSlug)?.sections.find((s) => s.id === sectionId);
	const images = new Map(
		section.images.flatMap((image) => {
			const value = current?.slots[image.id];
			return value && typeof value === 'object' ? [[image, value] as const] : [];
		}),
	);
	const updated = buildSection(section, copy, images);

	if (current) Object.assign(current, updated);
	return { section: updated };
};
