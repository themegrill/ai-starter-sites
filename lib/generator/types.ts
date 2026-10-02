import {
	GenerateRequest,
	GenerationPackage,
	GenerationProgress,
	RegenerateSectionRequest,
	Section,
	SwitchDemoRequest,
} from '../types';

// One interface for both pipelines, so routes don't care which one runs.
export interface Generator {
	generate(request: GenerateRequest): Promise<GenerationPackage>;
	regenerateSection(request: RegenerateSectionRequest): Promise<{ section: Section }>;
	switchDemo(request: SwitchDemoRequest): Promise<GenerationPackage>;
	status(generationId: string): Promise<GenerationProgress>;
}
