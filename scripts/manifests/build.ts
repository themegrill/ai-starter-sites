// Builds demo manifests from the live Zakra demo exports.
//
//   pnpm manifests                 build every demo in data/demo-catalog.json
//   pnpm manifests fitclub dentico build only these
//   pnpm manifests --refresh       ignore the download cache
//
// Writes data/manifests/<slug>.json, index.json, index.ts and REPORT.md.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	ColorOverrides,
	DemoCatalogEntry,
	DemoManifest,
	ImageSlot,
	MANIFEST_VERSION,
	ManifestPage,
	PageType,
	SectionFit,
} from '../../lib/demos/types';
import { classifyColors, normalizeColor } from './colors';
import { newColorContext, scanThemeMods } from './contrast';
import { assignRoles, buildGroups, pageTypeOf, scanPage } from './extract';
import { describeImage, mapLimit, saveImageCache } from './images';
import { fetchDemoData, fetchDemoList, fetchPageExport } from './source';
import { decodeEntities } from './text';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'data', 'manifests');
const CATALOG_FILE = path.join(ROOT, 'data', 'demo-catalog.json');

type CatalogItem = {
	slug: string;
	niches: string[];
	keywords: string[];
	colors?: ColorOverrides;
	sectionFit?: Record<string, SectionFit>;
};

const fontFamilyOf = (value: unknown) => {
	const family = (value as Record<string, unknown> | undefined)?.['font-family'];
	return typeof family === 'string' && family.toLowerCase() !== 'default' && family.toLowerCase() !== 'inherit'
		? family
		: undefined;
};

const mostUsed = (families: string[]) => {
	const counts = new Map<string, number>();
	families.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

const buildDemo = async (item: CatalogItem, listing: { title: string; previewImage: string; url: string } | undefined) => {
	const data = await fetchDemoData(item.slug);
	const themeMods = data.themeMods ?? {};
	const warnings: string[] = [];
	const colorCounts = new Map<string, number>();
	const themeColorCounts = new Map<string, number>();
	const fonts: { family: string; block: string }[] = [];
	const pages: ManifestPage[] = [];
	const colorContext = newColorContext();
	const ink = typeof themeMods.zakra_base_color === 'string' ? normalizeColor(themeMods.zakra_base_color) : undefined;

	for (const page of data.pages ?? []) {
		let exported: { title: string; content: string };
		try {
			exported = await fetchPageExport(page.content);
		} catch (error) {
			warnings.push(`${page.slug}: could not load export (${(error as Error).message})`);
			continue;
		}

		const scan = scanPage(exported.content, page.slug, { ctx: colorContext, ink });
		const images = scan.sections.flatMap((s) => s.images);
		await mapLimit(images, 8, async (image: ImageSlot) => Object.assign(image, await describeImage(image.url)));
		assignRoles(scan);

		scan.colors.forEach((hex) => colorCounts.set(hex, (colorCounts.get(hex) ?? 0) + 1));
		fonts.push(...scan.fonts);
		warnings.push(...scan.warnings);

		pages.push({
			slug: page.slug,
			title: decodeEntities(exported.title || page.title),
			type: pageTypeOf(page.slug),
			sourceUrl: page.content,
			sections: scan.sections,
			groups: buildGroups(scan.sections, item.sectionFit),
		});
	}

	// Theme-level colors count too: header, links and buttons use them.
	for (const [key, value] of Object.entries(themeMods)) {
		if (!/color/.test(key) || typeof value !== 'string') continue;
		const hex = normalizeColor(value);
		if (hex) themeColorCounts.set(hex, (themeColorCounts.get(hex) ?? 0) + 1);
	}
	scanThemeMods(themeMods, colorContext);
	const themePrimary =
		typeof themeMods.zakra_primary_color === 'string' ? normalizeColor(themeMods.zakra_primary_color) : undefined;

	// What the blocks render wins; theme typography is the fallback.
	const headingFont =
		mostUsed(fonts.filter((f) => f.block === 'blockart/heading').map((f) => f.family)) ??
		fontFamilyOf(themeMods.zakra_h1_typography) ??
		fontFamilyOf(themeMods.zakra_heading_typography);
	const bodyFont =
		mostUsed(fonts.filter((f) => f.block === 'blockart/paragraph').map((f) => f.family)) ??
		fontFamilyOf(themeMods.zakra_body_typography);
	// The main body family maps to the body font; any other family maps to
	// whichever role it mostly serves.
	const fontMap: Record<string, 'heading' | 'body'> = {};
	for (const family of new Set(fonts.map((f) => f.family))) {
		const inHeadings = fonts.filter((f) => f.family === family && f.block === 'blockart/heading').length;
		const elsewhere = fonts.filter((f) => f.family === family && f.block !== 'blockart/heading').length;
		fontMap[family] = family !== bodyFont && inHeadings >= elsewhere ? 'heading' : 'body';
	}
	// The demo's distinct display face, if it has one, is its "heading" font.
	const displayFont = mostUsed(
		fonts.filter((f) => f.block === 'blockart/heading' && fontMap[f.family] === 'heading').map((f) => f.family),
	);

	const sections = pages.flatMap((p) => p.sections);
	const slots = sections.flatMap((s) => s.slots);
	const images = sections.flatMap((s) => s.images);

	const colors = classifyColors(colorCounts, themeColorCounts, themePrimary, item.colors).map((c) => {
		const usage = colorContext.usage.get(c.hex);
		return usage ? { ...c, usage } : c;
	});
	const brandHexes = new Set(colors.filter((c) => c.group === 'brand').map((c) => c.hex));

	const manifest: DemoManifest = {
		version: MANIFEST_VERSION,
		slug: item.slug,
		name: decodeEntities(listing?.title ?? data.title),
		theme: 'zakra',
		premium: !!data.premium,
		previewImage: listing?.previewImage ?? '',
		demoUrl: listing?.url ?? data.url,
		niches: item.niches,
		keywords: item.keywords,
		plugins: Object.keys(data.plugins ?? {}),
		brand: {
			colors,
			contrastPairs: [...colorContext.pairs.values()]
				.filter((p) => brandHexes.has(p.fg) || brandHexes.has(p.bg))
				.sort((a, b) => b.count - a.count),
			fonts: {
				heading: displayFont ?? headingFont ?? bodyFont ?? 'Inter',
				body: bodyFont ?? headingFont ?? 'Inter',
				map: fontMap,
			},
		},
		pages,
		stats: {
			sections: sections.length,
			textSlots: slots.length,
			editableSlots: slots.filter((s) => !s.locked).length,
			images: images.length,
			swappableImages: images.filter((i) => !i.decorative).length,
			words: slots.filter((s) => !s.locked).reduce((sum, s) => sum + s.words, 0),
		},
		builtAt: new Date().toISOString(),
	};

	return { manifest, warnings };
};

const catalogEntry = (m: DemoManifest): DemoCatalogEntry => ({
	slug: m.slug,
	name: m.name,
	premium: m.premium,
	previewImage: m.previewImage,
	niches: m.niches,
	keywords: m.keywords,
	stats: m.stats,
	pageTypes: [...new Set(m.pages.map((p) => p.type))].filter((t): t is PageType => t !== 'other'),
});

const reportFor = (m: DemoManifest, warnings: string[]) => {
	const lines = [
		`## ${m.name} (\`${m.slug}\`)${m.premium ? ' · premium' : ''}`,
		'',
		`${m.stats.sections} sections · ${m.stats.editableSlots}/${m.stats.textSlots} editable text slots · ${m.stats.words} words · ${m.stats.swappableImages}/${m.stats.images} swappable images`,
		'',
		`Fonts: heading **${m.brand.fonts.heading}**, body **${m.brand.fonts.body}** (${Object.entries(m.brand.fonts.map)
			.map(([family, role]) => `${family} → ${role}`)
			.join(', ')})`,
		'',
		`Colors: ${m.brand.colors
			.map((c) => `\`${c.hex}\` ${c.role}${c.lightnessDelta ? ` (${c.lightnessDelta > 0 ? '+' : ''}${c.lightnessDelta})` : ''}${c.locked ? ` [locked: ${c.lockReason}]` : ''} ×${c.count}`)
			.join(', ')}`,
		'',
		`Contrast pairs checked after recoloring: ${m.brand.contrastPairs.length}`,
		'',
	];

	for (const page of m.pages) {
		lines.push(`### ${page.title} — \`${page.slug}\` → ${page.type}`, '');
		for (const g of page.groups) {
			const fit = g.fit.kind === 'core' ? 'core' : `needs ${g.fit.requires?.join(', ')}`;
			lines.push(`- Group **${g.role}** (${fit}) \`${g.id}\`, blocks ${g.paths.join(', ')}`);
			for (const s of page.sections.filter((x) => x.group === g.id)) {
				const editable = s.slots.filter((x) => !x.locked).length;
				const photos = s.images.filter((i) => !i.decorative).length;
				const lorem = s.slots.some((x) => x.placeholder) ? ' · lorem' : '';
				const dynamic = s.dynamicBlocks ? ` · dynamic: ${s.dynamicBlocks.join(', ')}` : '';
				lines.push(
					`  - **${s.role}** ${s.title ? `“${s.title}”` : '(untitled)'} — ${editable} text, ${photos} photos${lorem}${dynamic}`,
				);
			}
		}
		lines.push('');
	}

	if (warnings.length) {
		lines.push('<details><summary>Warnings</summary>', '', ...warnings.map((w) => `- ${w}`), '', '</details>', '');
	}
	return lines.join('\n');
};

const writeIndex = async () => {
	const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
	const manifests = await Promise.all(
		files.map(async (f) => JSON.parse(await readFile(path.join(OUT_DIR, f), 'utf8')) as DemoManifest),
	);

	await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifests.map(catalogEntry), null, '\t') + '\n');

	const imports = manifests.map((m, i) => `import m${i} from './${m.slug}.json';`).join('\n');
	const entries = manifests.map((m, i) => `\t'${m.slug}': m${i} as unknown as DemoManifest,`).join('\n');
	await writeFile(
		path.join(OUT_DIR, 'index.ts'),
		`// Generated by \`pnpm manifests\`. Do not edit by hand.
import type { DemoCatalogEntry, DemoManifest } from '../../lib/demos/types';
import catalog from './index.json';
${imports}

export const DEMO_CATALOG = catalog as unknown as DemoCatalogEntry[];

export const DEMO_MANIFESTS: Record<string, DemoManifest> = {
${entries}
};
`,
	);
	return manifests;
};

const main = async () => {
	const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
	const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as { demos: CatalogItem[] };
	const items = catalog.demos.filter((d) => !only.length || only.includes(d.slug));
	if (!items.length) {
		throw new Error(`No catalog demos match: ${only.join(', ')}`);
	}

	const listing = await fetchDemoList();
	await mkdir(OUT_DIR, { recursive: true });
	const reports = new Map<string, string>();
	const reportFile = path.join(OUT_DIR, 'REPORT.md');

	for (const item of items) {
		process.stdout.write(`${item.slug} ... `);
		const { manifest, warnings } = await buildDemo(item, listing.find((d) => d.slug === item.slug));
		await writeFile(path.join(OUT_DIR, `${item.slug}.json`), JSON.stringify(manifest, null, '\t') + '\n');
		reports.set(item.slug, reportFor(manifest, warnings));

		const s = manifest.stats;
		console.log(
			`${manifest.pages.length} pages, ${s.sections} sections, ${s.editableSlots} editable slots, ${s.swappableImages} photos${warnings.length ? `, ${warnings.length} warnings` : ''}`,
		);
	}
	await saveImageCache();

	// Keep report sections for demos not rebuilt this run.
	if (existsSync(reportFile)) {
		const previous = await readFile(reportFile, 'utf8');
		for (const chunk of previous.split(/\n(?=## )/).slice(1)) {
			const slug = chunk.match(/^## .*\(`([^`]+)`\)/)?.[1];
			if (slug && !reports.has(slug)) reports.set(slug, chunk.trimEnd() + '\n');
		}
	}

	const manifests = await writeIndex();
	const order = manifests.map((m) => m.slug).filter((slug) => reports.has(slug));
	await writeFile(
		reportFile,
		`# Demo manifest report\n\nGenerated by \`pnpm manifests\`. One line per section group (role, fit, top-level blocks), then its sections: detected role, first heading, editable text slots and swappable photos.\n\n${order.map((slug) => reports.get(slug)).join('\n')}`,
	);
	console.log(`\nWrote ${manifests.length} manifests to data/manifests/ (see REPORT.md)`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
