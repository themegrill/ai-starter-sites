// Fetches demo data from the ThemeGrill demo API, cached under .cache/ so
// re-runs are fast and work offline. Pass --refresh to bypass the cache.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.themegrill.com/zakra';
const NAMESPACE = '/wp-json/themegrill-demos/v1';
const CACHE_DIR = path.join(process.cwd(), '.cache', 'http');

export const refresh = process.argv.includes('--refresh');

const cachePath = (url: string) =>
	path.join(CACHE_DIR, createHash('sha1').update(url).digest('hex').slice(0, 16));

export const fetchText = async (url: string): Promise<string> => {
	const file = cachePath(url);
	if (!refresh && existsSync(file)) {
		return readFile(file, 'utf8');
	}

	const response = await fetch(url, { headers: { Accept: 'application/json, application/xml, */*' } });
	if (!response.ok) {
		throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
	}
	const text = await response.text();
	await mkdir(CACHE_DIR, { recursive: true });
	await writeFile(file, text);
	return text;
};

const fetchJson = async <T>(url: string): Promise<T> => JSON.parse(await fetchText(url)) as T;

export type DemoListItem = {
	slug: string;
	title: string;
	pagebuilder: string;
	categories: string[];
	previewImage: string;
	url: string;
};

export type DemoData = {
	slug: string;
	title: string;
	url: string;
	premium: boolean;
	themeMods: Record<string, unknown>;
	plugins: Record<string, { name: string }>;
	pages: { id: number; title: string; slug: string; content: string }[];
};

export const fetchDemoList = () => fetchJson<DemoListItem[]>(`${API_BASE}${NAMESPACE}/sites`);

export const fetchDemoData = async (slug: string) => {
	const response = await fetchJson<{ data?: DemoData } & DemoData>(`${API_BASE}/${slug}${NAMESPACE}/sites/data`);
	return response.data ?? response;
};

const decodeCdata = (value: string) => value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1');

const tagValue = (item: string, tag: string) => {
	const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
	return match?.[1] !== undefined ? decodeCdata(match[1].trim()) : '';
};

// Each demo page is exported as its own WXR file; pull the page item's
// title and block markup out of it.
export const fetchPageExport = async (url: string) => {
	const xml = await fetchText(url);
	const item = xml
		.split('<item>')
		.slice(1)
		.find((chunk) => tagValue(chunk, 'wp:post_type') === 'page');

	if (!item) {
		throw new Error(`No page item in ${url}`);
	}
	return { title: tagValue(item, 'title'), content: tagValue(item, 'content:encoded') };
};
