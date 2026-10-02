import { config } from '../config';
import { ApiError } from '../errors';
import { mockGenerator } from './mock';
import { Generator } from './types';

// Placeholder until the real pipeline lands (parse prompt -> pick demo ->
// brand kit -> Groq copy -> Pexels images -> assemble).
const notImplemented = async (): Promise<never> => {
	throw new ApiError('GENERATION_FAILED', 'Live generation is not available yet. Set MOCK=true.');
};

const liveGenerator: Generator = {
	generate: notImplemented,
	regenerateSection: notImplemented,
	switchDemo: notImplemented,
	status: notImplemented,
};

export const getGenerator = (): Generator => (config.mock ? mockGenerator : liveGenerator);
