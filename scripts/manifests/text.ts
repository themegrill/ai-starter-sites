import { LockReason } from '../../lib/demos/types';

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	rsquo: '’',
	lsquo: '‘',
	rdquo: '”',
	ldquo: '“',
	copy: '©',
	reg: '®',
	trade: '™',
};

export const decodeEntities = (value: string) =>
	value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
		if (code[0] === '#') {
			const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) ? String.fromCodePoint(n) : match;
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? match;
	});

export const hasMarkup = (value: string) => /<[a-z][^>]*>/i.test(value);

export const toPlainText = (value: string) =>
	decodeEntities(value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
		.replace(/\s+/g, ' ')
		.trim();

export const countWords = (text: string) => (text ? text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0);

// Short copy (buttons, labels) gets a little slack; longer copy stays within
// about 25% of the original so the layout holds.
export const wordLimits = (words: number) => ({
	minWords: Math.max(1, Math.round(words * 0.6)),
	maxWords: words <= 3 ? words + 2 : Math.ceil(words * 1.25),
});

const LOREM = /\b(lorem|ipsum|dolor sit|consectetur|adipiscing|turpis|vehicula|tempor|eiusmod|aliquam|feugiat|porttitor|vestibulum)\b/i;

export const isPlaceholderCopy = (text: string) => LOREM.test(text);

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\+?\(?\d[\d\s().-]{6,}\d/;
const URL = /\bhttps?:\/\/|\bwww\.\w/i;

// Text the model must not rewrite: quote marks and numbering, contact
// details (the model would invent them), and prices or stats.
export const lockReason = (text: string): LockReason | undefined => {
	if (!/\p{L}/u.test(text)) {
		return /\d/.test(text) ? 'number' : 'symbol';
	}
	if (EMAIL.test(text) || PHONE.test(text) || URL.test(text)) {
		return 'contact';
	}
	if (/^[\d\s$€£¥₹%+.,:/×x-]*[a-z]{0,3}[\d\s$€£¥₹%+.,:/-]*$/i.test(text) && /\d/.test(text)) {
		return 'number';
	}
	return undefined;
};
