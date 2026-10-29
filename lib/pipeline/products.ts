// Step 5c: the demo's WooCommerce products become this business's. One LLM
// call names each one (an antique shop's "Bronze Buddha Statue" becomes a
// bakery's "Sourdough Loaf"), writes a short description and a photo search;
// Pixabay finds the photo. Prices and categories stay as the demo set them.
import { DemoManifest } from '../demos/types';
import { getLlm } from '../llm';
import { GeneratedProduct, GenerateRequest } from '../types';
import { Brief } from './brief';
import { productPhotos } from './images';

const NAME_MAX = 60;
const DESCRIPTION_MAX = 240;

const SYSTEM = `You fill a website's shop with products for this business. The template's products are listed with their categories; replace each with one thing this business really sells (a service business sells packages or bookings). Keep the same number, all different, in a similar spread as the template's.
- name: a short product name, 2-6 words, no brand names of other companies, no prices.
- description: one or two plain sentences a customer would read, under 30 words.
- photo: a stock photo search for this product, 1-3 plain English words, the object itself ("sourdough bread", "leather wallet").`;

type Answer = { name?: string; description?: string; photo?: string };

const tidy = (value: unknown, max: number) =>
	String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max);

/**
 * New names, descriptions and photos for the demo's products. Empty when the
 * demo has none; throws only when aborted (the products then stay the demo's).
 */
export const productsFor = async (
	ctx: { request: GenerateRequest; brief: Brief; demo: DemoManifest },
	signal?: AbortSignal,
): Promise<GeneratedProduct[]> => {
	const products = ctx.demo.products ?? [];
	if (!products.length) return [];
	const keys = products.map((_, i) => `p${i + 1}`);
	const lines = [
		`Business: ${ctx.request.brandName}, a ${ctx.brief.businessType}. ${ctx.brief.summary}`,
		`Offerings: ${ctx.brief.offerings.join('; ')}`,
		'',
		...products.map((p, i) => `${keys[i]} | ${p.name}${p.categories.length ? ` | categories: ${p.categories.slice(0, 3).join(', ')}` : ''}`),
	];

	let data: Record<string, Answer>;
	try {
		const result = await getLlm().json<Record<string, Answer>>({
			name: 'products',
			system: SYSTEM,
			user: lines.join('\n'),
			schema: {
				type: 'object',
				properties: Object.fromEntries(
					keys.map((k) => [
						k,
						{
							type: 'object',
							properties: { name: { type: 'string' }, description: { type: 'string' }, photo: { type: 'string' } },
							required: ['name', 'description', 'photo'],
							additionalProperties: false,
						},
					]),
				),
				required: keys,
				additionalProperties: false,
			},
			maxTokens: 600 + products.length * 80,
			temperature: 0.4,
			signal,
		});
		data = result.data;
		const { usage } = result;
		console.log(`[products] ${products.length} products: ${usage.inputTokens} in / ${usage.outputTokens} out tokens, ${usage.ms}ms`);
	} catch (error) {
		if (signal?.aborted) throw error;
		console.warn('[products] writing failed, keeping the demo products:', error instanceof Error ? error.message : error);
		return [];
	}

	const written = products.flatMap((product, i) => {
		const answer = data[keys[i]!];
		const name = tidy(answer?.name, NAME_MAX);
		return name ? [{ product, name, description: tidy(answer?.description, DESCRIPTION_MAX), photo: tidy(answer?.photo, 100) || name }] : [];
	});
	const photos = await productPhotos(written.map((w) => ({ query: w.photo, alt: w.name })));
	return written.map((w, i) => ({
		demoId: w.product.id,
		name: w.name,
		description: w.description,
		...(photos[i] ? { image: photos[i] } : {}),
	}));
};
