import {
	GenerateRequest,
	GenerationPackage,
	GenerationProgress,
	RegenerateSectionRequest,
	Section,
	SwitchDemoRequest,
	DesignsResponse,
} from '../types';

export type GenerateOptions = {
	onProgress?: (progress: GenerationProgress) => void;
	signal?: AbortSignal;
};

// One interface for both pipelines, so routes don't care which one runs.
export interface Generator {
	designs(request: GenerateRequest, options?: { signal?: AbortSignal }): Promise<DesignsResponse>;
	generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerationPackage>;
	regenerateSection(request: RegenerateSectionRequest): Promise<{ section: Section }>;
	switchDemo(request: SwitchDemoRequest): Promise<GenerationPackage>;
	status(generationId: string): Promise<GenerationProgress>;
}
