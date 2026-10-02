import { AiErrorCode } from './types';

const STATUS: Record<AiErrorCode, number> = {
	RATE_LIMITED: 429,
	INVALID_INPUT: 400,
	GENERATION_FAILED: 500,
	UNAUTHORIZED: 401,
	NETWORK_ERROR: 502,
	INVALID_RESPONSE: 502,
	CANCELLED: 499,
};

export class ApiError extends Error {
	code: AiErrorCode;
	retryAfter?: number;

	constructor(code: AiErrorCode, message: string, retryAfter?: number) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.retryAfter = retryAfter;
	}

	get status() {
		return STATUS[this.code];
	}
}
