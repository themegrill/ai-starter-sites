import { parse } from '@wordpress/block-serialization-default-parser';
import { fetchDemoData, fetchPageExport } from './manifests/source';
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
(async () => {
  for (const slug of process.argv.slice(2)) {
    const data = await fetchDemoData(slug);
    for (const page of data.pages.filter((p) => /^home/.test(p.slug))) {
      const { content } = await fetchPageExport(page.content);
      console.log(`\n=== ${slug}/${page.slug}`);
      parse(content).filter((b) => b.blockName).forEach((top, i) => {
        const names = new Set<string>(); let imgs = 0;
        const walk = (b: any) => { if (b.blockName) names.add(b.blockName.replace('blockart/', '')); if (/image|team|modal/.test(b.blockName ?? '') ) imgs++; b.innerBlocks.forEach(walk); };
        walk(top);
        const text = strip(top.innerHTML + JSON.stringify(top.innerBlocks.map((b: any) => b.attrs?.text ?? '')));
        console.log(`${i} ${top.blockName} [${[...names].filter(n=>!/column|section|^container/.test(n)).slice(0,6).join(',')}] imgs=${imgs} :: ${strip(JSON.stringify(top)).replace(/\\[nt"]/g,' ').match(/"text":"([^"]{0,40})/)?.[1] ?? ''}`);
      });
    }
  }
})();
