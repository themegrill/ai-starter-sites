// BlockArt's Font Awesome icons (data/blockart-icons.json): resolving the
// names an LLM writes, and drawing them the way BlockArt saves an icon block.
import data from '../data/blockart-icons.json';

const ICONS = (data as { icons: Record<string, string> }).icons;

// "fa-solid fa-paw", "faPaw", "Paw icon" -> "paw".
const tidy = (name: string) =>
	name
		.replace(/([a-z])([A-Z])/g, '$1-$2')
		.toLowerCase()
		.replace(/\b(fa|fas|far|fa-solid|fa-regular|icon)\b/g, ' ')
		.replace(/\bfa-/g, '')
		.replace(/-(solid|regular)$/, '')
		.trim()
		.replace(/[\s_]+/g, '-')
		.replace(/[^a-z0-9-]/g, '');

/**
 * The BlockArt icon name for a Font Awesome name, solid style first; then
 * any icon named after one of its words. Undefined when nothing matches.
 */
export const resolveIcon = (name: string): string | undefined => {
	const base = tidy(name);
	if (!base) return undefined;
	for (const id of [`${base}-solid`, `${base}-regular`]) if (ICONS[id]) return id;
	for (const word of base.split('-').filter((w) => w.length > 2)) {
		const id = `${word}-solid`;
		if (ICONS[id]) return id;
	}
	return undefined;
};

/**
 * The SVG BlockArt saves inside an icon block (24px; the block's CSS sizes it),
 * so the editor accepts the block as valid. `style` is for the preview only.
 */
export const iconSvg = (id: string, style = ''): string => {
	const svg = ICONS[id];
	if (!svg) return '';
	return svg
		.replace(
			/^<svg /,
			`<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" ${style ? `style="${style}" ` : ''}`,
		)
		.replace(/>/, ' class="blockart-icon" aria-hidden="true">')
		.replace(/<(path|circle|rect|polygon|ellipse|line|polyline)([^>]*?)\s*\/>/g, '<$1$2></$1>');
};

/**
 * The icon as a standalone SVG data URI, for a block that shows it as its
 * background image (a heading with an icon beside it): on its circle or tile
 * when it has one. Colors must be validated hex.
 */
export const iconDataUri = (id: string, color: string, size: number, shape?: { color: string; radius: number; padding: number }) => {
	const svg = ICONS[id];
	if (!svg) return '';
	const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 512 512';
	const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
	const pad = shape?.padding ?? 0;
	const box = size + 2 * pad;
	const tile = shape ? `<rect width="${box}" height="${box}" rx="${(box * Math.min(shape.radius, 50)) / 100}" fill="${shape.color}"/>` : '';
	const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}">${tile}<svg x="${pad}" y="${pad}" width="${size}" height="${size}" viewBox="${viewBox}" fill="${color}">${inner}</svg></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(out).replace(/[()']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
};
