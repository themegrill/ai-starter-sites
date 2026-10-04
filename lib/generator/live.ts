// Real pipeline: Groq for the brief and copy, demo manifests for structure.
import { ApiError } from '../errors';
import { runGeneration, runRegenerateSection, runSwitchDemo } from '../pipeline/run';
import { getGeneration } from '../pipeline/store';
import { Generator } from './types';

export const liveGenerator: Generator = {
	generate: (request, options) => runGeneration(request, options),

	regenerateSection: ({ generationId, page, sectionId, instruction }) =>
		runRegenerateSection(generationId, page, sectionId, instruction),

	switchDemo: ({ generationId, demoSlug }) => runSwitchDemo(generationId, demoSlug),

	// Generations finish within the request (progress is streamed), so a known
	// id is always complete.
	async status(generationId) {
		if (!getGeneration(generationId)) {
			throw new ApiError('INVALID_INPUT', 'Unknown or expired generation id.');
		}
		return { step: 'assembling', progress: 1 };
	},
};
