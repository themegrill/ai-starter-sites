// Where each color is used, and which foreground sits on which background.
// The pipeline checks these pairs after recoloring a demo, so a new palette
// can't leave text, buttons or icons unreadable.
import { parse } from '@wordpress/block-serialization-default-parser';
import { ColorUse, ContrastPair } from '../../lib/demos/types';
import { normalizeColor } from './colors';

type Block = ReturnType<typeof parse>[number];

export type ColorContext = {
	usage: Map<string, Partial<Record<ColorUse, number>>>;
	pairs: Map<string, ContrastPair>;
};

export const newColorContext = (): ColorContext => ({ usage: new Map(), pairs: new Map() });

// Page background behind blocks that paint none (Zakra's default body color),
// and Zakra's default text color (palette color 6) when a demo doesn't set one.
export const PAGE_BACKGROUND = '#ffffff';
export const DEFAULT_TEXT = '#1f1f32';

// Blocks that show text in the theme's color unless they set their own.
const TEXT_BLOCKS = /^(blockart\/(heading|paragraph|icon-list-item|faq-inner)|core\/(paragraph|heading|list-item))$/;

const isColor = (value: unknown): value is string =>
	typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\()/i.test(value.trim());

const alphaOf = (value: string) => {
	const v = value.trim().toLowerCase();
	const rgba = v.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
	if (rgba) return Number(rgba[1]);
	const hex = v.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/)?.[1];
	if (hex) return parseInt(hex.length === 4 ? hex[3]! + hex[3]! : hex.slice(6), 16) / 255;
	return 1;
};

const mix = (top: string, bottom: string, alpha: number) => {
	const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));
	const [a, b] = [rgb(top), rgb(bottom)];
	return '#' + a.map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('');
};

/**
 * A color value as painted over `under`: transparent values are skipped
 * (undefined), translucent ones blended, and null when the result can't be
 * known (translucent over an image).
 */
const resolve = (value: string, under: string | null): string | null | undefined => {
	const hex = normalizeColor(value);
	const alpha = alphaOf(value);
	if (!hex || alpha < 0.05) return undefined;
	if (alpha >= 0.9) return hex;
	return under ? mix(hex, under, alpha) : null;
};

const get = (obj: Record<string, unknown>, path: string): unknown =>
	path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), obj);

const colorEntries = (value: unknown, path = ''): [string, string][] => {
	if (isColor(value)) return [[path, value]];
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([k, v]) => colorEntries(v, path ? `${path}.${k}` : k));
};

const useOf = (block: string, path: string): ColorUse => {
	const key = path.toLowerCase();
	if (block === 'core/separator' || /shadow|border|separator|divider/.test(key)) return 'border';
	if (/background/.test(key)) return 'background';
	if (/icon/.test(key) || block === 'blockart/icon') return 'icon';
	return 'text';
};

// Background the block paints behind its children: undefined to inherit,
// null when it's an image (contrast can't be checked against it).
const blockBackground = (attrs: Record<string, unknown>, under: string | null) => {
	if (get(attrs, 'background.image.image.url')) return null;
	const value = get(attrs, 'background.color') ?? get(attrs, 'style.color.background');
	return isColor(value) ? resolve(value, under) : undefined;
};

// The block's own background for one foreground attribute: "color1" sits on
// "background1", "hoverColor1" on "hoverBackground1" (or the normal one).
const ownBackgroundFor = (attrs: Record<string, unknown>, fgPath: string): string | undefined => {
	if (fgPath === 'style.color.text') {
		const v = get(attrs, 'style.color.background');
		return isColor(v) ? v : undefined;
	}
	const key = fgPath.split('.')[0]!;
	const names = [
		key.replace(/Color/, 'Background'),
		key.replace(/Color/, 'BackgroundColor'),
		key.replace(/^color/, 'background'),
		key.replace(/^hover/, '').replace(/^Color/, 'background').replace(/Color/, 'Background'),
	];
	for (const name of names) {
		if (name === key) continue;
		const v = get(attrs, name);
		if (isColor(v)) return v;
		const nested = get(attrs, `${name}.color`);
		if (isColor(nested)) return nested;
	}
	return undefined;
};

const isLarge = (block: string, attrs: Record<string, unknown>, use: ColorUse) =>
	use === 'icon' ||
	/button|socials?|social-links/.test(block) ||
	((block === 'blockart/heading' || block === 'core/heading') &&
		/^h[1-3]$/.test(String(attrs.markup ?? `h${attrs.level ?? 2}`)));

const count = (ctx: ColorContext, hex: string, use: ColorUse) => {
	const entry = ctx.usage.get(hex) ?? {};
	entry[use] = (entry[use] ?? 0) + 1;
	ctx.usage.set(hex, entry);
};

const addPair = (ctx: ColorContext, fg: string, bg: string, large: boolean, scope: ContrastPair['scope'] = 'blocks') => {
	if (fg === bg) return;
	const key = `${fg}|${bg}|${large ? 1 : 0}|${scope}`;
	const pair = ctx.pairs.get(key) ?? { fg, bg, large, count: 0, scope };
	pair.count++;
	ctx.pairs.set(key, pair);
};

const visit = (block: Block, under: string | null, ink: string, ctx: ColorContext) => {
	const name = block.blockName ?? '';
	const attrs = (block.attrs ?? {}) as Record<string, unknown>;
	const own = blockBackground(attrs, under);
	const behind = own === undefined ? under : own;
	const entries = colorEntries(attrs);

	// Text in the theme's color still has to read on a recolored background.
	if (behind && TEXT_BLOCKS.test(name) && !entries.some(([path]) => useOf(name, path) === 'text' && !/hover/i.test(path))) {
		addPair(ctx, ink, behind, isLarge(name, attrs, 'text'));
	}

	for (const [path, value] of entries) {
		const use = useOf(name, path);
		const hex = resolve(value, behind);
		if (!hex) continue;
		count(ctx, hex, use);
		if (use !== 'text' && use !== 'icon') continue;
		const ownBg = ownBackgroundFor(attrs, path);
		const bg = ownBg ? resolve(ownBg, behind) : behind;
		if (bg) addPair(ctx, hex, bg, isLarge(name, attrs, use));
	}
	block.innerBlocks.forEach((inner) => visit(inner, behind, ink, ctx));
};

export const scanColorContext = (blocks: Block[], ctx: ColorContext, ink = DEFAULT_TEXT) =>
	blocks.filter((b) => b.blockName).forEach((b) => visit(b, PAGE_BACKGROUND, ink, ctx));

const modColor = (value: unknown) => {
	const v = value && typeof value === 'object' ? (value as Record<string, unknown>)['background-color'] : value;
	return isColor(v) ? resolve(v, PAGE_BACKGROUND) : undefined;
};

/**
 * Theme settings pair up by name: "zakra_button_color" sits on
 * "zakra_button_background_color", "zakra_top_bar_color" on
 * "zakra_top_bar_background", "zakra_footer_column_widget_text_color" on
 * "zakra_footer_column_background". Link colors sit on the page.
 */
export const scanThemeMods = (mods: Record<string, unknown>, ctx: ColorContext) => {
	for (const [key, value] of Object.entries(mods)) {
		if (!/_color$/.test(key) || /background|border/.test(key)) continue;
		const fg = modColor(value);
		if (!fg) continue;
		const hover = /_hover_color$/.test(key);
		let base = key.replace(/(_hover)?_color$/, '');
		let bg: string | null | undefined;
		while (!bg && base.includes('_')) {
			bg = modColor(mods[hover ? `${base}_background_hover_color` : `${base}_background_color`]) ?? modColor(mods[`${base}_background`]);
			base = base.slice(0, base.lastIndexOf('_'));
		}
		if (!bg && /link|base|heading/.test(key)) bg = PAGE_BACKGROUND;
		if (bg) addPair(ctx, fg, bg, /button|title|heading/.test(key), 'theme');
	}
};
