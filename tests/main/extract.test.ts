import { describe, expect, it } from 'vitest';
import { detectBotProtection, extractSeo } from '../../src/main/extract';
import { loadHtml } from './test-utils';

const PAGE = 'https://example.com/blog/post';

const extract = (html: string, { url = PAGE, status = 200 as number | null, xRobots = '', headers = {} as Record<string, string> } = {}) =>
    extractSeo(loadHtml(html), url, status, { ...(xRobots && { 'x-robots-tag': xRobots }), ...headers });

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
        expect(r.titlePixelWidth).toBeGreaterThan(0);
        expect(r.metaDescriptionPixelWidth).toBeGreaterThan(0);
    });

    it('measures title and description pixel widths in their search-result font sizes', () => {
        const r = extract('<head><title>Crawler Test Site</title><meta name="description" content="Default description XIbwNE7SSUJciq0/Jyty"></head>');
        expect(r.titlePixelWidth).toBe(153);
        expect(r.metaDescriptionPixelWidth).toBe(270);
        expect(extract('<head></head>')).toMatchObject({ titlePixelWidth: 0, metaDescriptionPixelWidth: 0 });
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

    it('reads the first two H1s and the first H2 with their lengths', () => {
        const r = extract('<body><h1> First </h1><h2>Sub one</h2><h1>Second one</h1><h2>Sub two</h2></body>');
        expect(r).toMatchObject({ h1: 'First', h1Length: 5, h1Second: 'Second one', h1SecondLength: 10, h2: 'Sub one', h2Length: 7 });
        expect(extract('<body><h1>Only</h1></body>')).toMatchObject({ h1Second: '', h1SecondLength: 0, h2: '', h2Length: 0 });
    });

    it('reads meta keywords, meta refresh and the html lang', () => {
        const r = extract(`<html lang="en-GB"><head>
            <meta name="Keywords" content=" seo,  crawler ">
            <meta http-equiv="Refresh" content="5; url=/next">
        </head><body></body></html>`);
        expect(r).toMatchObject({ metaKeywords: 'seo, crawler', metaKeywordsLength: 12, metaRefresh: '5; url=/next', language: 'en-GB' });
    });

    it('reports the first two meta robots tags, and a noindex in the second makes the page non-indexable', () => {
        const r = extract('<head><meta name="robots" content="follow"><meta name="robots" content="NOINDEX"></head>');
        expect(r).toMatchObject({ metaRobots: 'follow', metaRobots2: 'noindex', indexable: false, indexabilityReason: 'noindex (meta)' });
    });

    it('keeps the X-Robots-Tag header as sent', () => {
        expect(extract('<body></body>', { xRobots: 'NoIndex, NoFollow' }).xRobotsTag).toBe('NoIndex, NoFollow');
    });

    it('resolves pagination, AMP and mobile alternate links', () => {
        const r = extract(`<head>
            <link rel="next" href="?page=3">
            <link rel="Prev" href="/blog/post?page=1">
            <link rel="amphtml" href="/amp/post">
            <link rel="alternate" hreflang="fr" href="/fr/post">
            <link rel="alternate" media="only screen and (max-width: 640px)" href="https://m.example.com/post">
        </head>`);
        expect(r).toMatchObject({
            relNext: 'https://example.com/blog/post?page=3',
            relPrev: 'https://example.com/blog/post?page=1',
            amphtml: 'https://example.com/amp/post',
            mobileAlternate: 'https://m.example.com/post',
        });
    });

    it('reads next and prev from the HTTP Link header', () => {
        const link = '</style.css>; rel=preload; as=style, <https://example.com/blog/post?page=3>; rel="next", </blog/post?page=1>; rel="prev start"';
        const r = extract('<body></body>', { headers: { link } });
        expect(r.httpRelNext).toBe('https://example.com/blog/post?page=3');
        expect(r.httpRelPrev).toBe('https://example.com/blog/post?page=1');
        expect(extract('<body></body>')).toMatchObject({ httpRelNext: '', httpRelPrev: '' });
    });

    it('lists the names of cookies set by the response', () => {
        const headers = { 'set-cookie': 'session=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT\nconsent=yes; Secure' };
        expect(extract('<body></body>', { headers }).cookies).toBe('session, consent');
        expect(extract('<body></body>').cookies).toBe('');
    });

    it('counts unique links separately from total links', () => {
        const r = extract(`<body>
            <a href="/a">1</a><a href="/a#x">same page, other fragment</a><a href="/b">2</a>
            <a href="https://google.com/">ext</a><a href="https://google.com/">ext again</a>
        </body>`);
        expect(r).toMatchObject({ internalLinks: 3, uniqueInternalLinks: 2, externalLinks: 2, uniqueExternalLinks: 1 });
    });
});

describe('extractSeo: readability', () => {
    it('ends sentences at punctuation and at block elements, not at source line breaks', () => {
        const r = extract(`<body>
            <h2>Menu heading</h2>
            <ul><li>Home</li><li>About us</li></ul>
            <p>The cat sat on
               the mat. It was happy! Was it?</p>
        </body>`);
        // "Menu heading", "Home", "About us", "The cat sat on the mat", "It was happy", "Was it".
        expect(r.sentenceCount).toBe(6);
        expect(r.wordCount).toBe(16);
        expect(r.avgWordsPerSentence).toBe(2.667);
    });

    it('scores simple text as easy and long, polysyllabic text as difficult', () => {
        const easy = extract('<body><p>The cat sat on the mat. The dog ran to the park. We had fun in the sun.</p></body>');
        const hard = extract(
            '<body><p>Comprehensive organizational methodologies necessitate considerable interdepartmental communication, particularly regarding sophisticated implementation responsibilities.</p></body>',
        );
        expect(easy.fleschReadingEase!).toBeGreaterThan(90);
        expect(easy.readability).toBe('Very Easy');
        expect(hard.fleschReadingEase!).toBeLessThan(30);
        expect(hard.readability).toBe('Very Difficult');
    });

    it('has no readability score for a page without text', () => {
        expect(extract('<body></body>')).toMatchObject({ sentenceCount: 0, avgWordsPerSentence: null, fleschReadingEase: null, readability: '' });
    });

    it('computes the text ratio as visible text over HTML size', () => {
        const r = extract('<body><p>abcd</p><script>var lots_of_code = 1;</script></body>');
        expect(r.textRatio).toBeGreaterThan(0);
        expect(r.textRatio).toBeLessThan(10);
        expect(extract('<body></body>').textRatio).toBe(0);
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

describe('detectBotProtection', () => {
    const cases: { name: string; status: number | null; headers?: Record<string, string>; html?: string; vendor: string | null }[] = [
        { name: 'Akamai challenge page served with 200', status: 200, html: '<div id="sec-if-cpt-container"></div>', vendor: 'Akamai' },
        { name: 'Akamai 403 "Access Denied"', status: 403, headers: { server: 'AkamaiGHost' }, html: '<title>Access Denied</title>', vendor: 'Akamai' },
        { name: 'Cloudflare challenge header', status: 403, headers: { 'cf-mitigated': 'challenge' }, vendor: 'Cloudflare' },
        { name: 'Cloudflare "Just a moment..." page', status: 503, headers: { server: 'cloudflare' }, html: '<title>Just a moment...</title>', vendor: 'Cloudflare' },
        { name: 'Cloudflare 403 block', status: 403, headers: { server: 'cloudflare' }, vendor: 'Cloudflare' },
        { name: 'normal page behind Akamai', status: 200, headers: { server: 'AkamaiGHost' }, html: '<title>Home</title>', vendor: null },
        { name: 'normal page behind Cloudflare with its JS detection script', status: 200, headers: { server: 'cloudflare' }, html: '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>', vendor: null },
        { name: 'real 404 behind Akamai', status: 404, headers: { server: 'AkamaiGHost' }, vendor: null },
        { name: 'plain 403 from an origin server', status: 403, headers: { server: 'nginx' }, vendor: null },
    ];

    it.each(cases)('$name', ({ status, headers = {}, html = '', vendor }) => {
        expect(detectBotProtection(status, headers, loadHtml(`<html><head>${html}</head><body></body></html>`))).toBe(vendor);
    });
});
