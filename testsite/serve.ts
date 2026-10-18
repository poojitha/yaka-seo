// Starts the test site for crawling in the app; prints what each issue filter should show. Run with `npm run testsite`.
import { FILTERS } from '../src/renderer/src/filters';
import { ALL_CASES, IGNORED_FILTERS, expectationFor, startTestSite, type Mode } from './site';

const port = Number(process.env.PORT ?? 4173);
const site = await startTestSite(port);

function summary(mode: Mode) {
    const counts = new Map<string, number>();
    let crawled = 0;
    for (const c of ALL_CASES) {
        const want = expectationFor(c, mode);
        if (!want.crawled) continue;
        crawled++;
        for (const f of want.filters) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const lines = FILTERS.filter((f) => counts.has(f.id)).map((f) => `  ${f.label.padEnd(24)} ${counts.get(f.id)}`);
    return [`${mode === 'fast' ? 'Fast HTML' : 'Render JS'} mode: ${crawled} URLs`, ...lines].join('\n');
}

console.log(`Yaka test site running at ${site.origin}/  (Ctrl+C to stop)\n`);
console.log('Expected issue counts with default settings (every URL also shows under Non-HTTPS URLs):\n');
console.log(summary('fast'));
console.log();
console.log(summary('js'));
console.log(`\nIgnored in the counts above: ${IGNORED_FILTERS.join(', ')}`);
