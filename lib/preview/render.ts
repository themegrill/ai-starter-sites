// Renders the generated page as it will look once imported: the live demo
// page, with the generated copy, photos, colors and fonts swapped in. Blocks
// are found by the clientId class BlockArt prints (blockart-heading-192e86dc);
// core blocks, which print none, by their demo text within their section.
import * as cheerio from 'cheerio';
import { ApiError } from '../errors';
import { DemoManifest, ManifestSection } from '../demos/types';
import { colorMapFor } from '../pipeline/color-map';
import { getManifest } from '../pipeline/pick-demo';
import { BrandKit, PreviewRequest } from '../types';

const CACHE_TTL = 60 * 60 * 1000;
const cache = new Map<string, { html: string; at: number }>();

const fetchDemoPage = async (url: string): Promise<string> => {
	const hit = cache.get(url);
	if (hit && Date.now() - hit.at < CACHE_TTL) return hit.html;
	const response = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
	if (!response?.ok) throw new ApiError('NETWORK_ERROR', 'The design preview could not be loaded.');
	const html = await response.text();
	cache.set(url, { html, at: Date.now() });
	return html;
};

const norm = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

const escapeHtml = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- Colors and fonts -------------------------------------------------------

const toHex6 = (hex: string): string =>
	hex.length === 4 ? '#' + hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(0, 7);

const recolor = (css: string, map: Record<string, string>): string =>
	css
		.replace(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi, (match) => {
			const mapped = map[toHex6(match.toLowerCase())];
			// Keep an 8-digit color's alpha.
			return mapped ? mapped + (match.length === 9 ? match.slice(7) : '') : match;
		})
		.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi, (match, r, g, b) => {
			const hex = '#' + [r, g, b].map((n: string) => Number(n).toString(16).padStart(2, '0')).join('');
			const mapped = map[hex];
			if (!mapped) return match;
			const [nr, ng, nb] = [1, 3, 5].map((i) => parseInt(mapped.slice(i, i + 2), 16));
			return match.replace(/\(\s*\d+\s*,\s*\d+\s*,\s*\d+/, `(${nr}, ${ng}, ${nb}`);
		});

const refont = (css: string, fonts: Record<string, string>): string =>
	Object.entries(fonts).reduce(
		(out, [from, to]) =>
			out.replace(
				new RegExp(`(font-family\\s*:\\s*)(['"]?)${escapeRegExp(from)}\\2(?=\\s*[,;}!"']|$)`, 'gi'),
				`$1'${to}'`,
			),
		css,
	);

const googleFontsLink = (brand: BrandKit) => {
	const families = [...new Set([brand.fonts.heading, brand.fonts.body])]
		.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`)
		.join('&');
	return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families}&display=swap">`;
};

// ---- Images -----------------------------------------------------------------

// A demo photo appears at several sizes (photo-1024x683.jpg) and in srcset.
const imagePattern = (url: string) => {
	const match = url.match(/^(.*?)(-scaled)?(\.[a-z0-9]+)$/i);
	if (!match) return new RegExp(escapeRegExp(url), 'g');
	const base = match[1]!.replace(/^https?:/, '');
	return new RegExp(`(?:https?:)?${escapeRegExp(base)}(?:-\\d+x\\d+)?(?:-scaled)?${escapeRegExp(match[3]!)}`, 'gi');
};

// ---- Copy -------------------------------------------------------------------

const TEXT_TAGS = 'h1,h2,h3,h4,h5,h6,p,li,a,span,button,summary,strong,em,div,figcaption,blockquote,cite';

export const renderPreview = async (request: PreviewRequest): Promise<string> => {
	const demo = getManifest(request.demoSlug);
	const page = demo?.pages.find((p) => p.slug === request.page || p.type === request.page);
	if (!demo || !page) throw new ApiError('INVALID_INPUT', 'That design is not available.');
	// Only the home page lives at the demo's root; inner pages aren't previewed yet.
	if (page.type !== 'home') throw new ApiError('INVALID_INPUT', 'Only the home page can be previewed.');

	const $ = cheerio.load(await fetchDemoPage(demo.demoUrl));
	const values = new Map(request.sections.flatMap((s) => Object.entries(s.slots)));
	const content = $('.zak-primary').first();
	const used = new Set<unknown>();

	const byClientId = (id: string, scope?: ReturnType<cheerio.CheerioAPI>) => {
		const selector = `[class*="-${id}"]`;
		const found = (scope ?? $.root()).find(selector).filter((_, el) =>
			($(el).attr('class') ?? '').split(/\s+/).some((c) => c.endsWith(`-${id}`)),
		);
		return found.first();
	};

	const sectionRoot = (section: ManifestSection) => {
		const el = byClientId(section.id, content);
		return el.length ? el : content.children().eq(section.index);
	};

	// The deepest element under `scope` whose text is exactly the demo copy.
	const findText = (scope: ReturnType<cheerio.CheerioAPI>, original: string) => {
		const want = norm(original);
		const all = scope.find(TEXT_TAGS).addBack().toArray().filter((el) => !used.has(el));
		const hits = all.filter((el) => norm($(el).text()) === want);
		return hits.find((el) => !$(el).find(TEXT_TAGS).toArray().some((child) => norm($(child).text()) === want));
	};

	const replaceImage: [RegExp, string][] = [];
	const overlays: string[] = [];

	for (const section of page.sections) {
		const root = sectionRoot(section);
		if (!root.length) continue;

		for (const slot of section.slots) {
			const value = values.get(slot.id);
			if (typeof value !== 'string' || value === slot.text || !slot.text.trim()) continue;
			const block = byClientId(slot.blockId, root);
			const el = findText(block.length ? block : root, slot.text) ?? (block.length ? findText(root, slot.text) : undefined);
			if (!el) continue;
			used.add(el);
			$(el).html(escapeHtml(value));
		}

		for (const image of section.images) {
			const value = values.get(image.id);
			if (!value || typeof value !== 'object' || !value.url || value.url === image.url) continue;
			replaceImage.push([imagePattern(image.url), value.url]);
			// The import darkens or lightens photos unlike the demo's so its text stays readable.
			const overlay = value.overlays?.[value.url];
			if (overlay && image.kind === 'background' && /^linear-gradient\([#\w\s,.%()]+\)$/.test(overlay)) {
				overlays.push(
					`.blockart-section-${image.blockId}.blockart-section{background-image:${overlay},url("${encodeURI(value.url)}")!important}`,
				);
			}
		}
	}

	// Sections left out because they don't fit the business.
	for (const groupId of request.removed) {
		const group = page.groups.find((g) => g.id === groupId);
		for (const sectionId of group?.sectionIds ?? []) {
			const section = page.sections.find((s) => s.id === sectionId);
			if (section) sectionRoot(section).remove();
		}
	}

	brandHeader($, request.brand, demo);
	styleAndFonts($, request, demo);

	// Swapped photos must not fall back to the demo's other sizes.
	if (replaceImage.length) $('img[srcset]').removeAttr('srcset').removeAttr('sizes');

	$('head').prepend('<meta name="robots" content="noindex">');
	$('head').append(googleFontsLink(request.brand)).append(PREVIEW_STYLE);
	if (overlays.length) $('head').append(`<style>${overlays.join('')}</style>`);
	$('body').append(PREVIEW_SCRIPT);

	let html = $.html();
	for (const [pattern, url] of replaceImage) html = html.replace(pattern, url);
	return html;
};

const brandHeader = ($: cheerio.CheerioAPI, brand: BrandKit, demo: DemoManifest) => {
	// The demo logo carries the demo's name; the import shows the site title instead.
	$('.custom-logo-link').remove();
	$('body').removeClass('wp-custom-logo');
	// The demo site's "Get this site" toolbar.
	$('.tg-demo-bar').remove();
	$('.site-title').removeClass('screen-reader-text').each((_, el) => {
		const link = $(el).find('a');
		(link.length ? link : $(el)).text(brand.siteTitle);
	});
	$('.site-description').text(brand.tagline);
	$('.site-info-wrap').removeClass('screen-reader-text');
	$('title').text(brand.siteTitle);
	// Footer credits and copy that name the demo.
	const name = new RegExp(`\\b${escapeRegExp(demo.name)}\\b`, 'g');
	$('footer')
		.find('*')
		.contents()
		.filter((_, node) => node.type === 'text')
		.each((_, node) => {
			const text = node as unknown as { data: string };
			text.data = text.data.replace(name, brand.siteTitle);
		});
};

const styleAndFonts = ($: cheerio.CheerioAPI, request: PreviewRequest, demo: DemoManifest) => {
	const { map, themeMap } = colorMapFor(demo, request.brand.palette);
	const fonts = Object.fromEntries(
		Object.entries(demo.brand.fonts.map).map(([family, role]) => [family, request.brand.fonts[role]]),
	);
	// Theme settings (header, footer, buttons) use their own map, like the import.
	const isTheme = (id = '') => /^(zakra-style-inline-css|wp-custom-css|global-styles-inline-css)$/.test(id);

	$('style').each((_, el) => {
		const css = $(el).html() ?? '';
		$(el).text(refont(recolor(css, isTheme($(el).attr('id')) ? themeMap : map), fonts));
	});
	$('[style]').each((_, el) => {
		$(el).attr('style', refont(recolor($(el).attr('style') ?? '', map), fonts));
	});
};

// Stops links and forms leaving the preview; the frame shows one page.
const PREVIEW_SCRIPT = `<script>
document.addEventListener('click', function (e) {
	var a = e.target.closest && e.target.closest('a');
	if (a && !(a.getAttribute('href') || '').startsWith('#')) e.preventDefault();
}, true);
document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
// Logo demos never styled the title; the import gives it the menu's color.
var menuLink = document.querySelector('.main-navigation .menu-item:not(.current-menu-item) > a');
if (menuLink) document.querySelectorAll('.site-title a').forEach(function (a) { a.style.color = getComputedStyle(menuLink).color; });
</script>`;

// The import turns the site title on (zakra_enable_site_identity), which the demo hid.
const PREVIEW_STYLE = `<style>#wpadminbar,.tg-demo-bar{display:none!important}html,body{margin-top:0!important}html{padding-top:0!important}.site-title{position:static!important;clip:auto!important}</style>`;
