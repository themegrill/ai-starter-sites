// Step 4: write copy for every editable text slot. Sections are batched into
// a few parallel LLM calls; each call returns one string per slot key.
import { DemoManifest, ManifestPage, ManifestSection, TextSlot } from '../demos/types';
import { getLlm, LlmUsage } from '../llm';
import { GenerateRequest } from '../types';
import { Brief } from './brief';
import { languageName } from './language';

export type CopyContext = { request: GenerateRequest; brief: Brief; demo: DemoManifest };

// Slot id -> new text, per page slug.
export type CopyResult = Record<string, Record<string, string>>;

type Job = { page: ManifestPage; section: ManifestSection };

const MAX_SLOTS_PER_CALL = 45;
const CONCURRENCY = 4;

export const editableSlots = (section: ManifestSection) => section.slots.filter((s) => !s.locked);

const KIND_LABEL: Record<TextSlot['kind'], string> = {
	heading: 'heading',
	paragraph: 'paragraph',
	button: 'button label',
	'list-item': 'list item',
	name: 'person name',
	role: 'job title',
	question: 'FAQ question',
	answer: 'FAQ answer',
	caption: 'image caption',
	overlay: 'image overlay label',
};

const system = (ctx: CopyContext) => `You are an expert website copywriter filling in an existing website template for a real business, one text slot at a time.
Rules:
- Write in ${languageName(ctx.request.language)}. Tone: ${ctx.request.tone}.
- Return text for every key. Stay inside each slot's word range.
- Headings: short and specific, no trailing period. The h1 is the page's main headline.
- Button labels: 1-3 word calls to action.
- Paragraphs and answers: concrete and specific to this business, no filler or clichés.
- Person names: realistic, varied names suited to the location. Job titles: short.
- Testimonials: first-person quotes from satisfied customers about this business.
- Keep the slots of a section coherent: the heading leads, the text supports it, the button follows from it.
- Never use lorem ipsum, placeholders, brackets, emojis, quotation marks around whole values, or markdown.
- Do not invent prices, phone numbers, emails, addresses, awards, years or statistics.
- "Template text" shows the length and shape of the original slot; it belongs to a different business, so do not copy its facts.`;

const businessBlock = ({ request, brief }: CopyContext) =>
	[
		`Business: ${request.brandName}, a ${brief.businessType}. ${brief.summary}`,
		`Audience: ${brief.audience}`,
		brief.location ? `Location: ${brief.location}` : '',
		`Offerings: ${brief.offerings.join('; ')}`,
		`Tagline: ${brief.tagline}`,
		`Owner's description: "${request.description}"`,
	]
		.filter(Boolean)
		.join('\n');

const slotLine = (key: string, slot: TextSlot) => {
	const range = slot.minWords === slot.maxWords ? `${slot.maxWords} words` : `${slot.minWords}-${slot.maxWords} words`;
	const label = slot.kind === 'heading' ? `${slot.tag ?? 'h2'} ${KIND_LABEL.heading}` : KIND_LABEL[slot.kind];
	const example = slot.placeholder ? '' : ` | template text: "${slot.text.slice(0, 160)}"`;
	return `${key} | ${label} | ${range}${example}`;
};

const buildPrompt = (ctx: CopyContext, jobs: Job[], keys: Map<TextSlot, string>, instruction?: string) => {
	const lines = [businessBlock(ctx), ''];
	let currentPage = '';
	jobs.forEach(({ page, section }, i) => {
		if (page.slug !== currentPage) {
			currentPage = page.slug;
			lines.push(`Page: ${page.title} (${page.type} page)`, '');
		}
		lines.push(`Section ${i + 1} (${section.role}):`);
		for (const slot of section.slots) {
			const key = keys.get(slot);
			if (key) lines.push(slotLine(key, slot));
		}
		const fixed = section.slots.filter((s) => s.locked).map((s) => `"${s.text}"`);
		if (fixed.length) lines.push(`Fixed text in this section, stay consistent with it: ${fixed.slice(0, 8).join(', ')}`);
		lines.push('');
	});
	if (instruction) lines.push(`Extra instruction from the site owner: ${instruction}`);
	return lines.join('\n');
};

const schemaFor = (keys: string[]) => ({
	type: 'object',
	properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])),
	required: keys,
	additionalProperties: false,
});

// Light clean-up; returns undefined when the value is unusable.
const clean = (value: unknown, slot: TextSlot): string | undefined => {
	if (typeof value !== 'string') return undefined;
	let text = value
		.replace(/\*\*|__|`/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^["“”'](.*)["“”']$/, '$1')
		.trim();
	if (slot.kind === 'heading' || slot.kind === 'button') text = text.replace(/\.$/, '');
	if (!text || /lorem ipsum|\[.*\]|\{.*\}/i.test(text)) return undefined;

	const words = text.split(' ');
	if (words.length > Math.ceil(slot.maxWords * 1.5)) return undefined;
	if (words.length > slot.maxWords + 1) {
		text = words.slice(0, slot.maxWords).join(' ').replace(/[,;:–—-]$/, '');
		if (slot.kind === 'paragraph' || slot.kind === 'answer') text = text.replace(/[^.!?…]$/, '$&.');
	}
	return text;
};

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const i = next++;
				results[i] = await fn(items[i] as T);
			}
		}),
	);
	return results;
};

const batch = (jobs: Job[]) => {
	const batches: Job[][] = [];
	let current: Job[] = [];
	let count = 0;
	for (const job of jobs) {
		const size = editableSlots(job.section).length;
		if (count + size > MAX_SLOTS_PER_CALL && current.length) {
			batches.push(current);
			current = [];
			count = 0;
		}
		current.push(job);
		count += size;
	}
	if (current.length) batches.push(current);
	return batches;
};

// Two sections with identical template text get identical copy (demos reuse
// home sections on the about page); only the first is sent to the model.
const signature = (section: ManifestSection) => section.slots.map((s) => `${s.kind}:${s.text}`).join('|');

type Totals = { usage: LlmUsage; fallbacks: number };

const runBatch = async (ctx: CopyContext, jobs: Job[], totals: Totals, instruction?: string, signal?: AbortSignal) => {
	const slots = jobs.flatMap((j) => editableSlots(j.section));
	const keys = new Map(slots.map((slot, i) => [slot, `k${i + 1}`]));
	const values = new Map<TextSlot, string>();

	const ask = async (pending: TextSlot[], pendingJobs: Job[]) => {
		const pendingKeys = new Map(pending.map((s) => [s, keys.get(s)!]));
		const maxWords = pending.reduce((sum, s) => sum + s.maxWords, 0);
		const { data, usage } = await getLlm().json<Record<string, unknown>>({
			name: 'section_copy',
			system: system(ctx),
			user: buildPrompt(ctx, pendingJobs, pendingKeys, instruction),
			schema: schemaFor([...pendingKeys.values()]),
			maxTokens: Math.min(8000, 1200 + maxWords * 4),
			signal,
		});
		totals.usage.inputTokens += usage.inputTokens;
		totals.usage.outputTokens += usage.outputTokens;
		totals.usage.ms = Math.max(totals.usage.ms, usage.ms);
		for (const slot of pending) {
			const text = clean(data[pendingKeys.get(slot)!], slot);
			if (text) values.set(slot, text);
		}
	};

	await ask(slots, jobs);

	// One repair call for anything empty, over length or placeholder-like.
	const missing = slots.filter((s) => !values.has(s));
	if (missing.length) {
		const missingJobs = jobs.filter((j) => j.section.slots.some((s) => missing.includes(s)));
		await ask(missing, missingJobs).catch(() => undefined);
	}

	for (const slot of slots) {
		if (!values.has(slot)) {
			totals.fallbacks++;
			// Real template copy beats nothing; lorem never ships.
			values.set(slot, slot.placeholder ? (slot.kind === 'button' ? 'Learn More' : ctx.brief.tagline) : slot.text);
		}
	}
	return values;
};

export const writeCopy = async (
	ctx: CopyContext,
	pages: ManifestPage[],
	options: { onBatchDone?: (done: number, total: number) => void; signal?: AbortSignal } = {},
) => {
	const totals: Totals = { usage: { inputTokens: 0, outputTokens: 0, ms: 0 }, fallbacks: 0 };
	const jobs: Job[] = [];
	const firstBySignature = new Map<string, ManifestSection>();
	const copies: { section: ManifestSection; source: ManifestSection; page: ManifestPage }[] = [];

	for (const page of pages) {
		for (const section of page.sections) {
			if (!editableSlots(section).length) continue;
			const sig = signature(section);
			const source = firstBySignature.get(sig);
			if (source) {
				copies.push({ section, source, page });
			} else {
				firstBySignature.set(sig, section);
				jobs.push({ page, section });
			}
		}
	}

	const batches = batch(jobs);
	let done = 0;
	const results = await mapLimit(batches, CONCURRENCY, async (b) => {
		const values = await runBatch(ctx, b, totals, undefined, options.signal);
		options.onBatchDone?.(++done, batches.length);
		return values;
	});
	const values = new Map(results.flatMap((m) => [...m.entries()]));

	const result: CopyResult = {};
	const set = (page: ManifestPage, slot: TextSlot, text: string) => ((result[page.slug] ??= {})[slot.id] = text);

	for (const { page, section } of jobs) {
		for (const slot of editableSlots(section)) set(page, slot, values.get(slot)!);
	}
	for (const { section, source, page } of copies) {
		const sourceSlots = editableSlots(source);
		editableSlots(section).forEach((slot, i) => set(page, slot, values.get(sourceSlots[i]!) ?? slot.text));
	}

	return { copy: result, usage: totals.usage, fallbacks: totals.fallbacks };
};

export const writeSectionCopy = async (
	ctx: CopyContext,
	page: ManifestPage,
	section: ManifestSection,
	instruction?: string,
	signal?: AbortSignal,
) => {
	const totals: Totals = { usage: { inputTokens: 0, outputTokens: 0, ms: 0 }, fallbacks: 0 };
	const values = await runBatch(ctx, [{ page, section }], totals, instruction, signal);
	return {
		copy: Object.fromEntries(editableSlots(section).map((s) => [s.id, values.get(s)!])),
		usage: totals.usage,
	};
};
