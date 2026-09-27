import { createRequire } from 'node:module';
import type { CheerioRoot } from 'crawlee';

// cheerio is only installed nested under crawlee; load the copy CheerioCrawler itself uses.
const requireFromCrawlee = createRequire(createRequire(import.meta.url).resolve('@crawlee/cheerio'));
const cheerio = requireFromCrawlee('cheerio') as { load: (html: string) => CheerioRoot };

export const loadHtml = (html: string): CheerioRoot => cheerio.load(html);
