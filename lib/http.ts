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

export const corsHeadersFor = (request: Request) => corsHeaders(request);

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

type StreamEvent =
	| { type: 'progress'; step: string; progress: number }
	| { type: 'result'; package: unknown }
	| AiErrorPayload & { type: 'error' };

const toApiError = (error: unknown) => {
	if (error instanceof ApiError) return error;
	console.error(error);
	return new ApiError('GENERATION_FAILED', 'Something went wrong while generating your site.');
};

/**
 * POST route that can stream progress. With `Accept: application/x-ndjson`
 * the response is one JSON event per line: progress events, then a final
 * `result` or `error` event. Without it, it behaves like postRoute.
 * Auth and validation errors are returned before streaming starts, as
 * normal JSON errors with their HTTP status.
 */
export const streamingPostRoute =
	<T>(
		validate: (body: unknown) => T,
		handler: (body: T, emit: (event: { step: string; progress: number }) => void, signal: AbortSignal) => Promise<unknown>,
	) =>
	async (request: Request) => {
		let body: T;
		try {
			authorize(request);
			body = validate(await readBody(request));
		} catch (error) {
			return errorResponse(request, toApiError(error));
		}

		if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
			try {
				return json(request, await handler(body, () => undefined, request.signal));
			} catch (error) {
				return errorResponse(request, toApiError(error));
			}
		}

		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
				try {
					const result = await handler(body, (p) => send({ type: 'progress', ...p }), request.signal);
					send({ type: 'result', package: result });
				} catch (error) {
					if (!request.signal.aborted) {
						const apiError = toApiError(error);
						send({
							type: 'error',
							error: {
								code: apiError.code,
								message: apiError.message,
								...(apiError.retryAfter ? { retryAfter: apiError.retryAfter } : {}),
							},
						});
					}
				} finally {
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				...corsHeadersFor(request),
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'Cache-Control': 'no-cache, no-transform',
				'X-Accel-Buffering': 'no',
			},
		});
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
