import { config } from './config';
import { ApiError } from './errors';
import { AiErrorPayload } from './types';

// The plugin calls this API from the browser in wp-admin, so every response
// needs CORS headers and every route answers the preflight OPTIONS request.
const corsHeaders = (request: Request): Record<string, string> => {
	const origin = request.headers.get('origin');
	const allowed = config.allowedOrigins;
	const allowOrigin = allowed.includes('*') ? '*' : origin && allowed.includes(origin) ? origin : '';

	return {
		...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, X-Site-Token',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
};

export const json = (request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) =>
	Response.json(body, { status, headers: { ...corsHeaders(request), ...extra } });

export const preflight = (request: Request) =>
	new Response(null, { status: 204, headers: corsHeaders(request) });

const errorResponse = (request: Request, error: ApiError) => {
	const payload: AiErrorPayload = {
		error: {
			code: error.code,
			message: error.message,
			...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
		},
	};
	const extra: Record<string, string> = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
	return json(request, payload, error.status, extra);
};

const authorize = (request: Request) => {
	const tokens = config.siteTokens;
	if (!tokens.length) {
		return;
	}
	const token = request.headers.get('x-site-token') ?? '';
	if (!tokens.includes(token)) {
		throw new ApiError('UNAUTHORIZED', 'This site is not authorized to use AI generation.');
	}
};

const readBody = async (request: Request): Promise<unknown> => {
	try {
		return await request.json();
	} catch {
		throw new ApiError('INVALID_INPUT', 'Request body must be valid JSON.');
	}
};

type Handler<T> = (body: T, request: Request) => Promise<unknown>;

// Wraps a POST route: auth, JSON parsing, validation, CORS and error shaping.
export const postRoute =
	<T>(validate: (body: unknown) => T, handler: Handler<T>) =>
	async (request: Request) => {
		try {
			authorize(request);
			const body = validate(await readBody(request));
			return json(request, await handler(body, request));
		} catch (error) {
			if (error instanceof ApiError) {
				return errorResponse(request, error);
			}
			console.error(error);
			return errorResponse(request, new ApiError('GENERATION_FAILED', 'Something went wrong while generating your site.'));
		}
	};

export const getRoute =
	<C>(handler: (request: Request, context: C) => Promise<unknown>) =>
	async (request: Request, context: C) => {
		try {
			authorize(request);
			return json(request, await handler(request, context));
		} catch (error) {
			if (error instanceof ApiError) {
				return errorResponse(request, error);
			}
			console.error(error);
			return errorResponse(request, new ApiError('GENERATION_FAILED', 'Something went wrong.'));
		}
	};
