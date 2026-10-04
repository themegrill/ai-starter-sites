// Language codes the plugin sends, as names the model understands.
const LANGUAGES: Record<string, string> = {
	en: 'English',
	es: 'Spanish',
	fr: 'French',
	de: 'German',
	it: 'Italian',
	pt: 'Portuguese',
	nl: 'Dutch',
	hi: 'Hindi',
	ne: 'Nepali',
	ja: 'Japanese',
	zh: 'Chinese (Simplified)',
	ar: 'Arabic',
};

export const languageName = (code: string) => LANGUAGES[code.split(/[-_]/)[0] ?? 'en'] ?? 'English';
