import { describe, expect, it } from 'vitest';
import { extractSeo } from '../../src/main/extract';
import { loadHtml } from './test-utils';

const PAGE = 'https://example.com/blog/post';

const extract = (html: string, { url = PAGE, status = 200 as number | null, xRobots = '' } = {}) => extractSeo(loadHtml(html), url, status, xRobots);

describe('extractSeo: on-page fields', () => {
    it('reads title and meta description, collapsing whitespace', () => {
        const r = extract(`<html><head>
            <title>  My   Title
            </title>
            <meta name="Description" content="  Some   description  ">
        </head><body></body></html>`);
        expect(r.title).toBe('My Title');
        expect(r.titleLength).toBe(8);
        expect(r.metaDescription).toBe('Some description');
        expect(r.metaDescriptionLength).toBe(16);
    });

    it('returns empty strings when title and description are missing', () => {
        const r = extract('<html><head></head><body><p>hi</p></body></html>');
        expect(r.title).toBe('');
        expect(r.titleLength).toBe(0);
        expect(r.metaDescription).toBe('');
        expect(r.metaDescriptionLength).toBe(0);
    });

    it('ignores <title> elements outside <head> (e.g. inline SVG titles)', () => {
        const r = extract('<html><head><title>Real</title></head><body><svg><title>Icon</title></svg></body></html>');
        expect(r.title).toBe('Real');
    });

    it('counts headings and takes the first H1 text', () => {
        const r = extract('<body><h1> First  H1 </h1><h1>Second</h1><h2>a</h2><h2>b</h2><h2>c</h2></body>');
        expect(r.h1).toBe('First H1');
        expect(r.h1Count).toBe(2);
        expect(r.h2Count).toBe(3);
    });

    it('counts words in visible body text only', () => {
        const r = extract(`<body>
            <p>one two three</p>
            <script>var hidden = "not counted at all";</script>
            <style>.x { color: red }</style>
            <noscript>enable javascript please</noscript>
            <template><p>template words</p></template>
            <p>four five</p>
        </body>`);
        expect(r.wordCount).toBe(5);
    });

    it('reports zero words for an empty body', () => {
        expect(extract('<body>   </body>').wordCount).toBe(0);
    });

    it('splits links into internal (same hostname) and external, skipping non-http links', () => {
        const r = extract(`<body>
            <a href="/about">relative</a>
            <a href="other">relative 2</a>
            <a href="https://example.com/x#frag">absolute same host</a>
            <a href="http://example.com:8080/">same hostname, other port</a>
            <a href="https://www.example.com/">www is a different host</a>
            <a href="https://google.com/">external</a>
            <a href="mailto:a@b.com">mail</a>
            <a href="tel:123">tel</a>
            <a href="javascript:void(0)">js</a>
            <a>no href</a>
        </body>`);
        expect(r.internalLinks).toBe(4);
        expect(r.externalLinks).toBe(2);
    });

    it('counts images with a missing or blank alt', () => {
        const r = extract('<body><img src="a"><img src="b" alt=""><img src="c" alt="   "><img src="d" alt="ok"></body>');
        expect(r.imagesMissingAlt).toBe(3);
    });

    it('resolves a relative canonical against the page URL', () => {
        const r = extract('<head><link rel="Canonical" href="/blog/post#top"></head>');
        expect(r.canonical).toBe('https://example.com/blog/post');
    });

    it('lower-cases meta robots', () => {
        expect(extract('<head><meta name="ROBOTS" content="NoFollow, NoArchive"></head>').metaRobots).toBe('nofollow, noarchive');
    });
});

describe('extractSeo: indexability', () => {
    const cases: { name: string; html?: string; status?: number | null; xRobots?: string; url?: string; indexable: boolean; reason: string }[] = [
        { name: 'plain 200 page', indexable: true, reason: '' },
        { name: 'unknown status (null) is not penalised', status: null, indexable: true, reason: '' },
        { name: '404', status: 404, indexable: false, reason: 'Status 404' },
        { name: '500', status: 500, indexable: false, reason: 'Status 500' },
        { name: '301', status: 301, indexable: false, reason: 'Status 301' },
        { name: 'meta noindex', html: '<meta name="robots" content="noindex, follow">', indexable: false, reason: 'noindex (meta)' },
        { name: 'meta none', html: '<meta name="robots" content="none">', indexable: false, reason: 'noindex (meta)' },
        { name: 'X-Robots-Tag noindex', xRobots: 'NOINDEX', indexable: false, reason: 'noindex (X-Robots-Tag)' },
        { name: 'X-Robots-Tag none', xRobots: 'none', indexable: false, reason: 'noindex (X-Robots-Tag)' },
        { name: 'canonical to another URL', html: '<link rel="canonical" href="https://example.com/other">', indexable: false, reason: 'Canonicalised' },
        { name: 'self-referencing canonical', html: `<link rel="canonical" href="${PAGE}">`, indexable: true, reason: '' },
        { name: 'canonical differing only by trailing slash', html: `<link rel="canonical" href="${PAGE}/">`, indexable: true, reason: '' },
        {
            name: 'status is checked before noindex',
            status: 404,
            html: '<meta name="robots" content="noindex">',
            indexable: false,
            reason: 'Status 404',
        },
    ];

    it.each(cases)('$name', ({ html = '', status = 200, xRobots = '', url = PAGE, indexable, reason }) => {
        const r = extract(`<html><head>${html}</head><body></body></html>`, { status, xRobots, url });
        expect(r.indexable).toBe(indexable);
        expect(r.indexabilityReason).toBe(reason);
    });
});
