// Generations kept for regenerate-section and switch-demo. In-memory for now:
// fine for `next dev` and a single warm instance, but serverless instances
// don't share memory, so production needs a shared store (Upstash Redis) here.
import { DemoManifest, ImageSlot as ManifestImage } from '../demos/types';
import { GenerateRequest, GenerationPackage, ImageSlot } from '../types';
import { Brief } from './brief';

export type StoredGeneration = {
	request: GenerateRequest;
	brief: Brief;
	demo: DemoManifest;
	pkg: GenerationPackage;
	// `${pageSlug}/${sectionId}` -> copywriter note for repurposed and removed
	// groups, so regenerating or restoring a section keeps the decision.
	notes: Map<string, string>;
	images: Map<ManifestImage, ImageSlot>;
	createdAt: number;
};

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const generations = new Map<string, StoredGeneration>();

const prune = () => {
	const now = Date.now();
	for (const [id, entry] of generations) {
		if (now - entry.createdAt > TTL_MS) generations.delete(id);
	}
	while (generations.size > MAX_ENTRIES) {
		generations.delete(generations.keys().next().value!);
	}
};

export const saveGeneration = (id: string, entry: Omit<StoredGeneration, 'createdAt'>) => {
	generations.set(id, { ...entry, createdAt: Date.now() });
	prune();
};

export const getGeneration = (id: string) => {
	prune();
	return generations.get(id);
};
