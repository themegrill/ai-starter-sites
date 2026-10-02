import { getGenerator } from '@/lib/generator';
import { getRoute, preflight } from '@/lib/http';

export const OPTIONS = preflight;

export const GET = getRoute(async (_request, { params }: { params: Promise<{ id: string }> }) =>
	getGenerator().status((await params).id),
);
