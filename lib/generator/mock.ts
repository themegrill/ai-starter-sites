// Mock pipeline returning fixture packages. Put one of these tags in the
// description (or a regenerate instruction) to force an error response:
//   #ratelimit #invalid #fail #unauthorized #badresponse
import { ApiError } from '../errors';
import { buildPackage, fillSection, findFixtureByDemo, pickFixture } from '../fixtures';
import { config } from '../config';
import { GenerateRequest, Section, SlotValue } from '../types';
import { Generator } from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const throwForTag = (text: string) => {
	const has = (tag: string) => text.includes(tag);
	if (has('#ratelimit')) throw new ApiError('RATE_LIMITED', 'You’ve reached today’s AI generation limit.', 3600);
	if (has('#invalid')) throw new ApiError('INVALID_INPUT', 'The description could not be understood. Try adding more detail.');
	if (has('#unauthorized')) throw new ApiError('UNAUTHORIZED', 'This site is not authorized to use AI generation.');
	if (has('#fail')) throw new ApiError('GENERATION_FAILED', 'Something went wrong while generating your site.');
	if (has('#badresponse')) throw new ApiError('INVALID_RESPONSE', 'The AI service returned an unexpected response.');
};

// Serverless instances don't share memory, so the mock carries the original
// request inside the generation id. The real pipeline will store generations
// in KV and use a short random id instead.
const ID_PREFIX = 'gen_mock_';

const encodeId = (request: GenerateRequest) =>
	ID_PREFIX + Buffer.from(JSON.stringify(request)).toString('base64url');

const decodeId = (id: string): GenerateRequest => {
	if (!id.startsWith(ID_PREFIX)) {
		throw new ApiError('INVALID_INPUT', 'Unknown generation id.');
	}
	try {
		return JSON.parse(Buffer.from(id.slice(ID_PREFIX.length), 'base64url').toString('utf8'));
	} catch {
		throw new ApiError('INVALID_INPUT', 'Unknown generation id.');
	}
};

const OPENERS = ['Simply put, ', 'Here’s the idea: ', 'In short, '];

const rewrite = (value: SlotValue, instruction: string, variant: number): SlotValue => {
	if (typeof value !== 'string') {
		return value;
	}
	const words = value.split(' ');
	if (/short/i.test(instruction) && words.length > 4) {
		return words.slice(0, Math.ceil(words.length * 0.6)).join(' ').replace(/[,;:.]$/, '') + '.';
	}
	if (words.length > 8) {
		const opener = OPENERS[variant % OPENERS.length] ?? '';
		return opener + value.charAt(0).toLowerCase() + value.slice(1);
	}
	return value;
};

export const mockGenerator: Generator = {
	async generate(request) {
		throwForTag(request.description);
		await sleep(config.mockDelayMs);
		return buildPackage(encodeId(request), pickFixture(request), request);
	},

	async regenerateSection({ generationId, page, sectionId, instruction = '' }) {
		throwForTag(instruction);
		const request = decodeId(generationId);
		await sleep(config.mockDelayMs);

		const fixture = pickFixture(request);
		const source = fixture.pages[page as keyof typeof fixture.pages]?.sections.find((s) => s.id === sectionId);
		if (!source) {
			throw new ApiError('INVALID_INPUT', 'That section could not be found.');
		}

		const filled = fillSection(source, request.brandName);
		const variant = Math.floor(Math.random() * OPENERS.length);
		const section: Section = {
			...filled,
			slots: Object.fromEntries(
				Object.entries(filled.slots).map(([key, value]) => [key, rewrite(value, instruction, variant)]),
			),
		};
		return { section };
	},

	async switchDemo({ generationId, demoSlug }) {
		const request = decodeId(generationId);
		const fixture = findFixtureByDemo(demoSlug);
		const demo = fixture && [fixture.demo, ...fixture.alternatives].find((d) => d.slug === demoSlug);
		if (!fixture || !demo) {
			throw new ApiError('INVALID_INPUT', 'That design is not available.');
		}
		await sleep(config.mockDelayMs);
		return buildPackage(generationId, fixture, request, demo);
	},

	// Mock generations finish within the request, so they are always done.
	async status(generationId) {
		decodeId(generationId);
		return { step: 'assembling', progress: 1 };
	},
};
