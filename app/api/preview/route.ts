import { postRoute, preflight } from '@/lib/http';
import { renderPreview } from '@/lib/preview/render';
import { validatePreview } from '@/lib/validate';

export const OPTIONS = preflight;

// The generated page on the live demo page, as HTML for a sandboxed iframe.
export const POST = postRoute(validatePreview, async (body) => ({ html: await renderPreview(body) }));
