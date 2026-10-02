import { config } from '@/lib/config';
import { json, preflight } from '@/lib/http';

export const OPTIONS = preflight;

export async function GET(request: Request) {
	return json(request, {
		ok: true,
		mode: config.mock ? 'mock' : 'live',
		model: config.mock ? null : config.groqModel,
		tokenRequired: config.siteTokens.length > 0,
	});
}
