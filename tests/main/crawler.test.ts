import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { log } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
import { co2Milligrams } from '../../src/main/carbon';
import { SiteCrawler } from '../../src/main/crawler';

/*
 * Test site, served on 127.0.0.1 (depth of each page from "/" in brackets):
 *
 *   /                [0] links to everything below, plus off-scope links
 *   ├─ /a            [1] ─ /a/deep [2] ─ /a/deep/deeper [3]
 *   ├─ /b            [1] meta noindex
 *   ├─ /xrobots      [1] X-Robots-Tag: noindex
 *   ├─ /missing      [1] 404, and links to /from-404 (must not be followed)
 *   ├─ /redirect     [1] 301 -> /c
 *   ├─ /broken       [1] connection is dropped (network failure)
 *   ├─ /private/...      disallowed by robots.txt
 *   └─ localhost / example.org links: other hostnames, out of scope
 *
 * Unlinked: /slow (concurrency), /spa (JavaScript), /blocked and /challenge (bot protection),
 * /docs/guide/page (response headers, size and hash), /weight/a ─ /weight/b (transferred bytes),
 * /dup ─ /dup/1, /dup/2 (near duplicates of each other), /dup/3 (different text), /dup/noindex (copy of /dup/1).
 * /bad-charset is HTML served with charset=utf-6, which no decoder knows.
 * Parsed as browsers do: /bare-text is text with no tags at all; /div-in-head has a <div> in <head>, which ends the
 * head, so the canonical and rel=next after it are in <body>.
 * Redirects: /chain 302 -> /redirect 301 -> /c, /loop 302 -> itself, /meta-refresh and /refresh-header (-> /c),
 * /js-redirect (location.replace -> /c), /push-state (history.pushState, not a redirect).
 * /files links to non-HTML responses: an image, a PDF (noindex and canonical by header), a 204, an unknown
 * Content-Type, and a 301 to another image (/files/moved.png).
 */
const html = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const links = (...paths: string[]) => paths.map((p) => `<a href="${p}">${p}</a>`).join('\n');

type Route = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
const page =
    (body: string, head = '', status = 200, headers: Record<string, string> = {}): Route =>
    (_req, res) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
        res.end(html(body, head));
    };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: Server;
let origin: string;
let port: number;
/** Paths the server has been asked for, in order (robots.txt excluded). */
let requested: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
/** User-Agent header of each page request, by path. */
let userAgents = new Map<string, string>();

const DETAILS_BODY = html('<h1>Guide</h1><p>Short text.</p>', '<title>Guide</title>');
const WEIGHT_RESOURCES = '<link rel="stylesheet" href="/weight/style.css"><img src="/weight/pixel.png">';
const WEIGHT_A_BODY = html(`${WEIGHT_RESOURCES}${links('/weight/b')}<p>${'Compressible text. '.repeat(200)}</p>`, '<title>A</title>');
const WEIGHT_A_GZIP = gzipSync(WEIGHT_A_BODY);
const WEIGHT_CSS = `body { color: #333; }\n${'/* padding */\n'.repeat(100)}`;
// A valid 1x1 PNG, so the browser finishes loading it.
const WEIGHT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const ARTICLE = Array.from({ length: 200 }, (_, i) => `This is sentence ${i} of the article.`).join(' ');
const OTHER_ARTICLE = Array.from({ length: 200 }, (_, i) => `Another text, paragraph ${i * 3} here.`).join(' ');

const routes: Record<string, Route> = {
    '/robots.txt': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /private\n');
    },
    '/': (req, res) =>
        page(
            links('/a', '/b', '/xrobots', '/missing', '/redirect', '/broken', '/private/secret', `http://localhost:${port}/offsite`, 'https://example.org/'),
            '<title>Home</title><meta name="description" content="Home page">',
        )(req, res),
    '/a': page(`<h1>A</h1>${links('/a/deep')}`, '<title>A</title>'),
    '/a/deep': page(links('/a/deep/deeper'), '<title>Deep</title>'),
    '/a/deep/deeper': page('<p>leaf</p>', '<title>Deeper</title>'),
    '/b': page('<p>b</p>', '<title>B</title><meta name="robots" content="noindex">'),
    '/xrobots': page('<p>x</p>', '<title>X</title>', 200, { 'x-robots-tag': 'noindex' }),
    '/missing': page(links('/from-404'), '<title>Not found</title>', 404),
    '/from-404': page('<p>should never be crawled</p>'),
    '/redirect': (_req, res) => {
        res.writeHead(301, { location: '/c' });
        res.end();
    },
    '/c': page('<p>redirect target</p>', '<title>C</title>'),
    '/chain': (_req, res) => {
        res.writeHead(302, { location: '/redirect' });
        res.end();
    },
    '/loop': (_req, res) => {
        res.writeHead(302, { location: '/loop' });
        res.end();
    },
    '/meta-refresh': page('<p>moving</p>', '<title>Moving</title><meta http-equiv="refresh" content="0; url=/c">'),
    '/refresh-header': page('<p>moving</p>', '<title>Refresh header</title>', 200, { refresh: '0; url=/c' }),
    '/js-redirect': page('<p>moving</p><script>location.replace("/c")</script>', '<title>JS redirect</title>'),
    '/push-state': page('<p>stays</p><script>history.pushState({}, "", "/pushed")</script>', '<title>Push state</title>'),
    '/broken': (req) => {
        req.socket.destroy();
    },
    '/private/secret': page('<p>robots.txt should block this</p>'),

    // Separate mini-site for concurrency / stop tests: a hub linking to 20 slow pages.
    '/slow': page(links(...Array.from({ length: 20 }, (_, i) => `/slow/${i}`))),

    // Client-rendered page: title and a link only exist after JavaScript runs.
    '/spa': page(
        '<div id="root"></div><script>document.title = "Rendered title"; document.getElementById("root").innerHTML = \'<h1>Hello</h1><a href="/spa/child">child</a>\';</script>',
    ),
    '/spa/child': page('<p>child</p>', '<title>Child</title>'),

    // Bot protection: an Akamai edge block, and an Akamai challenge served with 200 whose links aren't the site's.
    '/blocked': page('<h1>Access Denied</h1>', '<title>Access Denied</title>', 403, { server: 'AkamaiGHost' }),
    '/challenge': page(`<div id="sec-if-cpt-container"></div>${links('/from-challenge')}`),
    '/from-challenge': page('<p>should never be crawled</p>'),

    // Near duplicates: /dup/2 is /dup/1 with one word changed; /dup/noindex is an exact copy but isn't checked.
    '/dup': page(links('/dup/1', '/dup/2', '/dup/3', '/dup/noindex', '/dup/1'), '<title>Dup hub</title>'),
    '/dup/1': page(`<p>${ARTICLE}</p>${links('/dup')}`, '<title>One</title>'),
    '/dup/2': page(`<p>${ARTICLE.replace('sentence 150', 'sentence changed')}</p>${links('/dup', '/dup/1')}`, '<title>Two</title>'),
    '/dup/3': page(`<p>${OTHER_ARTICLE}</p>`, '<title>Three</title>'),
    '/dup/noindex': page(`<p>${ARTICLE}</p>`, '<title>Copy</title><meta name="robots" content="noindex">'),

    '/bad-charset': page('<p>Readable anyway</p>', '<title>Bad charset</title>', 200, { 'content-type': 'text/html; charset=utf-6' }),

    '/bare-text': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('Status code 200 body');
    },
    '/div-in-head': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>Div</title><div>oops</div><link rel="canonical" href="/elsewhere"><link rel="next" href="/n"></head><body><p>Text</p></body></html>');
    },

    // Linked files that aren't HTML: each is still a row, with its status and headers.
    '/files': page(links('/files/pixel.png', '/files/doc.pdf', '/files/empty', '/files/odd', '/files/to-image'), '<title>Files</title>'),
    '/files/pixel.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': WEIGHT_PNG.length, 'last-modified': 'Tue, 01 Sep 2026 10:00:00 GMT' });
        res.end(WEIGHT_PNG);
    },
    '/files/doc.pdf': (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf', 'x-robots-tag': 'noindex', link: '</files/other.pdf>; rel="canonical"' });
        res.end('%PDF-1.4 not really a pdf');
    },
    '/files/empty': (_req, res) => {
        res.writeHead(204);
        res.end();
    },
    '/files/odd': (_req, res) => {
        res.writeHead(200, { 'content-type': 'abc/xyz; charset=UTF-8' });
        res.end('text');
    },
    '/files/to-image': (_req, res) => {
        res.writeHead(301, { location: '/files/moved.png' });
        res.end();
    },
    '/files/moved.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(WEIGHT_PNG);
    },

    // Response-level fields: headers the crawler reports, and a fixed body for size and hash.
    '/docs/guide/page': (_req, res) => {
        res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'last-modified': 'Tue, 01 Sep 2026 10:00:00 GMT',
            'set-cookie': ['session=abc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'consent=yes'],
            link: '</docs/guide/page?p=2>; rel="next"',
        });
        res.end(DETAILS_BODY);
    },

    // Page weight: /weight/a is gzipped and chunked (no Content-Length); both pages load the same cacheable CSS and image.
    '/weight/a': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
        res.write(WEIGHT_A_GZIP.subarray(0, 100));
        res.end(WEIGHT_A_GZIP.subarray(100));
    },
    '/weight/b': page(WEIGHT_RESOURCES, '<title>B</title>'),
    '/weight/style.css': (_req, res) => {
        // Explicit Content-Length: after writeHead() Node would otherwise send it chunked, and the browser counts chunk framing.
        res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600', 'content-length': Buffer.byteLength(WEIGHT_CSS) });
        res.end(WEIGHT_CSS);
    },
    '/weight/pixel.png': (_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'content-length': WEIGHT_PNG.length });
        res.end(WEIGHT_PNG);
    },
};

beforeAll(async () => {
    // Keep Crawlee from writing ./storage and from logging every request.
    process.env.CRAWLEE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'screamingai-test-'));
    log.setLevel(log.LEVELS.OFF);

    server = createServer(async (req, res) => {
        const path = new URL(req.url!, 'http://x').pathname;
        if (path !== '/robots.txt') requested.push(path);
        userAgents.set(path, req.headers['user-agent'] ?? '');
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            if (path.startsWith('/slow/')) {
                await sleep(400);
                page(`<p>${path}</p>`, `<title>${path}</title>`)(req, res);
            } else {
                await (routes[path] ?? page('<p>not found</p>', '', 404))(req, res);
            }
        } finally {
            inFlight--;
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(process.env.CRAWLEE_STORAGE_DIR!, { recursive: true, force: true });
});

beforeEach(() => {
    requested = [];
    inFlight = 0;
    maxInFlight = 0;
    userAgents = new Map();
});

const defaults: Omit<CrawlOptions, 'startUrl'> = { maxPages: 100, maxDepth: 10, concurrency: 5, renderJs: false, userAgent: '' };

async function crawl(path: string, options: Partial<CrawlOptions> = {}, crawler = new SiteCrawler()) {
    const rows: PageResult[] = [];
    const analysis = await crawler.run({ ...defaults, startUrl: origin + path, ...options }, (r) => rows.push(r));
    const byPath = new Map(rows.map((r) => [new URL(r.url).pathname, r]));
    /** Post-crawl fields for a path. */
    const analysed = (p: string) => analysis[byPath.get(p)!.url];
    return { rows, byPath, paths: [...byPath.keys()].sort(), analysis, analysed };
}

describe('SiteCrawler (fast HTML mode)', () => {
    it('crawls every in-scope page and reports each exactly once', async () => {
        const { rows, paths } = await crawl('/');
        expect(paths).toEqual(['/', '/a', '/a/deep', '/a/deep/deeper', '/b', '/broken', '/c', '/missing', '/redirect', '/xrobots']);
        expect(rows).toHaveLength(paths.length);
    });

    it('extracts SEO fields, status, content type, depth and timing for a page', async () => {
        const { byPath } = await crawl('/');
        const home = byPath.get('/')!;
        expect(home).toMatchObject({
            status: 200,
            contentType: 'text/html; charset=utf-8',
            depth: 0,
            title: 'Home',
            metaDescription: 'Home page',
            indexable: true,
            redirectUrl: null,
            error: null,
            // localhost counts as external: a different hostname from 127.0.0.1.
            internalLinks: 7,
            externalLinks: 2,
        });
        expect(home.responseTimeMs).toBeGreaterThanOrEqual(0);
        expect(byPath.get('/a')).toMatchObject({ depth: 1, h1: 'A' });
        expect(byPath.get('/a/deep/deeper')!.depth).toBe(3);
    });

    it('respects robots.txt', async () => {
        const { paths } = await crawl('/');
        expect(paths).not.toContain('/private/secret');
        expect(requested).not.toContain('/private/secret');
    });

    it('stays on the start hostname (127.0.0.1 and localhost are different hosts)', async () => {
        const { rows } = await crawl('/');
        expect(requested).not.toContain('/offsite');
        expect(rows.every((r) => new URL(r.url).hostname === '127.0.0.1')).toBe(true);
    });

    it('reports 4xx pages as results and does not follow their links', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/missing')).toMatchObject({ status: 404, indexable: false, indexabilityReason: 'Status 404', error: null });
        expect(requested).not.toContain('/from-404');
        // Reported once, not retried as a failure.
        expect(requested.filter((p) => p === '/missing')).toHaveLength(1);
    });

    it('reports a redirect as its own 3xx row and crawls the target as a separate row', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/redirect')).toMatchObject({
            status: 301,
            statusText: 'Moved Permanently',
            redirectUrl: `${origin}/c`,
            redirectType: 'HTTP Redirect',
            indexable: false,
            indexabilityReason: 'Redirected',
            title: '',
            error: null,
        });
        expect(byPath.get('/c')).toMatchObject({ status: 200, title: 'C', depth: 2, redirectUrl: null });
        expect(byPath.get('/a')).toMatchObject({ redirectType: '', redirectUrl: null });
    });

    it('reports each hop of a redirect chain', async () => {
        const { byPath } = await crawl('/chain');
        expect(byPath.get('/chain')).toMatchObject({ status: 302, redirectUrl: `${origin}/redirect`, depth: 0 });
        expect(byPath.get('/redirect')).toMatchObject({ status: 301, redirectUrl: `${origin}/c`, depth: 1 });
        expect(byPath.get('/c')).toMatchObject({ status: 200, title: 'C', depth: 2 });
    });

    it('reports a redirect loop as a redirect, not an error', async () => {
        const { byPath } = await crawl('/loop');
        expect(byPath.get('/loop')).toMatchObject({ status: 302, redirectUrl: `${origin}/loop`, redirectType: 'HTTP Redirect', error: null });
    });

    it.each([
        ['/meta-refresh', 'Meta Refresh Redirect', 'Moving'],
        ['/refresh-header', 'HTTP Refresh Redirect', 'Refresh header'],
    ])('reports %s as a %s with its own content, and crawls the target', async (path, redirectType, title) => {
        const { byPath } = await crawl(path);
        expect(byPath.get(path)).toMatchObject({
            status: 200,
            title,
            redirectType,
            redirectUrl: `${origin}/c`,
            indexable: false,
            indexabilityReason: 'Redirected',
            error: null,
        });
        expect(byPath.get('/c')).toMatchObject({ status: 200, title: 'C' });
    });

    it('reports linked files that are not HTML as rows with their status and headers, not as errors', async () => {
        const { byPath } = await crawl('/files');
        expect(byPath.get('/files/pixel.png')).toMatchObject({
            status: 200,
            contentType: 'image/png',
            sizeBytes: WEIGHT_PNG.length,
            transferredBytes: WEIGHT_PNG.length,
            lastModified: 'Tue, 01 Sep 2026 10:00:00 GMT',
            title: '',
            wordCount: 0,
            indexable: true,
            error: null,
        });
        // Header directives apply to any file.
        expect(byPath.get('/files/doc.pdf')).toMatchObject({
            contentType: 'application/pdf',
            xRobotsTag: 'noindex',
            canonical: `${origin}/files/other.pdf`,
            indexable: false,
            indexabilityReason: 'noindex (X-Robots-Tag)',
            error: null,
        });
        expect(byPath.get('/files/empty')).toMatchObject({ status: 204, statusText: 'No Content', contentType: null, sizeBytes: 0, error: null });
        expect(byPath.get('/files/odd')).toMatchObject({ status: 200, contentType: 'abc/xyz; charset=UTF-8', error: null });
        // A redirect whose target isn't HTML still queues the target.
        expect(byPath.get('/files/to-image')).toMatchObject({ status: 301, redirectUrl: `${origin}/files/moved.png` });
        expect(byPath.get('/files/moved.png')).toMatchObject({ status: 200, contentType: 'image/png', error: null });
    });

    it('reads a page with an unknown charset as UTF-8 instead of failing it', async () => {
        const { byPath } = await crawl('/bad-charset');
        expect(byPath.get('/bad-charset')).toMatchObject({
            status: 200,
            contentType: 'text/html; charset=utf-6',
            title: 'Bad charset',
            wordCount: 2,
            error: null,
        });
    });

    it('parses HTML as a browser does: implied <body>, and a <div> ends <head>', async () => {
        const { byPath } = await crawl('/bare-text');
        expect(byPath.get('/bare-text')).toMatchObject({ wordCount: 4, textRatio: 100 });
        const { byPath: div } = await crawl('/div-in-head');
        // Link elements only count in <head>, so these are ignored.
        expect(div.get('/div-in-head')).toMatchObject({ title: 'Div', canonical: '', relNext: '', indexable: true });
    });

    it('reports response details: status text, HTTP version, headers, size, hash, folder depth and timestamp', async () => {
        const before = Date.now();
        const { byPath } = await crawl('/docs/guide/page', { maxDepth: 0 });
        const row = byPath.get('/docs/guide/page')!;
        expect(row).toMatchObject({
            statusText: 'OK',
            httpVersion: '1.1',
            lastModified: 'Tue, 01 Sep 2026 10:00:00 GMT',
            cookies: 'session, consent',
            httpRelNext: `${origin}/docs/guide/page?p=2`,
            sizeBytes: Buffer.byteLength(DETAILS_BODY),
            hash: createHash('md5').update(DETAILS_BODY).digest('hex'),
            folderDepth: 2,
            urlEncoded: `${origin}/docs/guide/page`,
        });
        expect(Date.parse(row.crawlTimestamp)).toBeGreaterThanOrEqual(before - 1000);
        expect(byPath.size).toBe(1);
    });

    it('reports compressed bytes transferred for a gzipped, chunked page; Total Transferred is the same (HTML only)', async () => {
        const { byPath } = await crawl('/weight/a', { maxDepth: 0 });
        expect(byPath.get('/weight/a')).toMatchObject({
            sizeBytes: Buffer.byteLength(WEIGHT_A_BODY),
            transferredBytes: WEIGHT_A_GZIP.length,
            totalTransferredBytes: WEIGHT_A_GZIP.length,
            co2Mg: co2Milligrams(WEIGHT_A_GZIP.length),
            // Not rated from the HTML alone.
            carbonRating: '',
        });
        expect(WEIGHT_A_GZIP.length).toBeLessThan(Buffer.byteLength(WEIGHT_A_BODY) / 2);
    });

    it('reports transferred bytes equal to the size for an uncompressed page', async () => {
        const { byPath } = await crawl('/docs/guide/page', { maxDepth: 0 });
        const size = Buffer.byteLength(DETAILS_BODY);
        expect(byPath.get('/docs/guide/page')).toMatchObject({ sizeBytes: size, transferredBytes: size, totalTransferredBytes: size });
    });

    it('sends rows without post-crawl fields, then returns inlinks and link scores for every page', async () => {
        const { rows, analysis, analysed } = await crawl('/');
        expect(rows.every((r) => r.inlinks === null && r.linkScore === null)).toBe(true);
        expect(Object.keys(analysis).sort()).toEqual(rows.map((r) => r.url).sort());

        expect(analysed('/')).toMatchObject({ inlinks: 0, uniqueInlinks: 0 });
        expect(analysed('/a')).toMatchObject({ inlinks: 1, uniqueInlinks: 1, uniqueJsInlinks: 0 });
        expect(analysed('/a/deep/deeper')).toMatchObject({ inlinks: 1, uniqueInlinks: 1 });
        // Unlinked pages and failures are still in the analysis, with their own link counts.
        expect(analysed('/broken')).toMatchObject({ uniqueInlinks: 1 });
        // /a, /a/deep, /a/deep/deeper, /b, /xrobots and /redirect (-> /c) are the 200 HTML pages besides /.
        expect(analysed('/a').percentOfTotal).toBeCloseTo((1 / 7) * 100, 2);

        const scores = Object.values(analysis).map((a) => a.linkScore!);
        expect(Math.max(...scores)).toBe(100);
        expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
        // Deeper in a chain means more rank has flowed down to it.
        expect(analysed('/a/deep/deeper').linkScore!).toBeGreaterThan(analysed('/').linkScore!);
    });

    it('finds near-duplicate pages after the crawl, skipping non-indexable ones', async () => {
        const { analysed } = await crawl('/dup');
        expect(analysed('/dup/1')).toMatchObject({ nearDuplicates: 1, closestNearDuplicate: `${origin}/dup/2` });
        expect(analysed('/dup/1').closestNearDuplicateSimilarity!).toBeGreaterThanOrEqual(90);
        expect(analysed('/dup/2')).toMatchObject({ nearDuplicates: 1, closestNearDuplicate: `${origin}/dup/1` });
        expect(analysed('/dup/3')).toMatchObject({ nearDuplicates: 0, closestNearDuplicate: '' });
        expect(analysed('/dup/noindex')).toMatchObject({ nearDuplicates: null, closestNearDuplicate: '' });
        // /dup links to /dup/1 twice; /dup/2 links to it too.
        expect(analysed('/dup/1')).toMatchObject({ inlinks: 3, uniqueInlinks: 2 });
    });

    it('reports no JS-only links in fast HTML mode', async () => {
        const { byPath } = await crawl('/dup', { maxDepth: 0 });
        expect(byPath.get('/dup')).toMatchObject({ uniqueJsOutlinks: 0, uniqueExternalJsOutlinks: 0 });
    });

    it('gives 404 rows their status text', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/missing')!.statusText).toBe('Not Found');
    });

    it('reports noindex from meta robots and from the X-Robots-Tag header', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/b')).toMatchObject({ indexable: false, indexabilityReason: 'noindex (meta)' });
        expect(byPath.get('/xrobots')).toMatchObject({ indexable: false, indexabilityReason: 'noindex (X-Robots-Tag)' });
    });

    it('turns network failures into error rows', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/broken')).toMatchObject({ status: null, indexable: false, indexabilityReason: 'Error', depth: 1 });
        expect(byPath.get('/broken')!.error).toBeTruthy();
    });

    it.each([
        [0, ['/']],
        [1, ['/', '/a', '/b', '/broken', '/missing', '/redirect', '/xrobots']],
        [2, ['/', '/a', '/a/deep', '/b', '/broken', '/c', '/missing', '/redirect', '/xrobots']],
    ])('Depth %i limits how far links are followed', async (maxDepth, expected) => {
        const { paths } = await crawl('/', { maxDepth });
        expect(paths).toEqual(expected);
    });

    it.each([1, 3, 5])('Max pages %i caps the number of results', async (maxPages) => {
        const { rows } = await crawl('/', { maxPages });
        expect(rows).toHaveLength(maxPages);
    });

    it('sends the configured User-Agent, or a real-browser one when it is empty', async () => {
        await crawl('/a', { maxDepth: 0, userAgent: 'Mozilla/5.0 (compatible; TestBot/1.0)' });
        expect(userAgents.get('/a')).toBe('Mozilla/5.0 (compatible; TestBot/1.0)');

        await crawl('/a', { maxDepth: 0, userAgent: '' });
        expect(userAgents.get('/a')).toMatch(/Chrome\//);
    });

    it.each([
        ['/blocked', 403],
        ['/challenge', 200],
    ])('reports %s as blocked by bot protection and does not follow its links', async (path, status) => {
        const { byPath, paths } = await crawl(path);
        expect(byPath.get(path)).toMatchObject({ status, indexable: false, indexabilityReason: 'Blocked', title: '' });
        expect(byPath.get(path)!.error).toMatch(/^Blocked by bot protection \(Akamai\)/);
        expect(paths).toEqual([path]);
    });

    it('Threads caps how many requests run at once', async () => {
        await crawl('/slow', { concurrency: 2 });
        expect(maxInFlight).toBeLessThanOrEqual(2);
    });

    it('Threads actually runs requests in parallel', async () => {
        // 20 pages x 400 ms. Crawlee normally reaches the full Threads value at once; allow some slack for a busy machine.
        await crawl('/slow', { concurrency: 5 });
        expect(maxInFlight).toBeGreaterThanOrEqual(3);
    });

    it('a second crawl starts from a fresh queue', async () => {
        const crawler = new SiteCrawler();
        const first = await crawl('/', { maxDepth: 1 }, crawler);
        const second = await crawl('/', { maxDepth: 1 }, crawler);
        expect(second.paths).toEqual(first.paths);
    });

    it('isRunning is true only during a crawl, and a second concurrent run is rejected', async () => {
        const crawler = new SiteCrawler();
        expect(crawler.isRunning).toBe(false);
        const running = crawler.run({ ...defaults, startUrl: `${origin}/`, maxDepth: 0 }, () => {});
        await expect(crawler.run({ ...defaults, startUrl: `${origin}/` }, () => {})).rejects.toThrow('A crawl is already running');
        expect(crawler.isRunning).toBe(true);
        await running;
        expect(crawler.isRunning).toBe(false);
    });

    it('stop() ends the crawl early and run() resolves', async () => {
        const crawler = new SiteCrawler();
        const rows: PageResult[] = [];
        await crawler.run({ ...defaults, startUrl: `${origin}/slow`, concurrency: 1 }, (r) => {
            rows.push(r);
            if (rows.length === 2) crawler.stop();
        });
        expect(rows.length).toBeGreaterThanOrEqual(2);
        expect(rows.length).toBeLessThan(21);
        expect(crawler.isRunning).toBe(false);
    });

    it('stop() right after run() starts, while the queue is still opening, is not lost', async () => {
        const crawler = new SiteCrawler();
        const rows: PageResult[] = [];
        const running = crawler.run({ ...defaults, startUrl: `${origin}/slow`, concurrency: 1 }, (r) => rows.push(r));
        crawler.stop();
        await running;
        expect(rows).toEqual([]);
        expect(requested).toEqual([]);
        expect(crawler.isRunning).toBe(false);
    });

    it('stop() when no crawl is running does not affect the next crawl', async () => {
        const crawler = new SiteCrawler();
        crawler.stop();
        await crawler.teardown();
        const { paths } = await crawl('/', { maxDepth: 0 }, crawler);
        expect(paths).toEqual(['/']);
    });
});

describe('SiteCrawler (Render JavaScript mode)', () => {
    it('sees content and links that only exist after JavaScript runs', async () => {
        const { byPath, paths } = await crawl('/spa', { renderJs: true, concurrency: 2 });
        expect(byPath.get('/spa')).toMatchObject({ status: 200, title: 'Rendered title', h1: 'Hello', h1Count: 1 });
        expect(paths).toContain('/spa/child');
        expect(byPath.get('/spa/child')!.title).toBe('Child');
    });

    it('counts links that only exist after JavaScript as JS outlinks and JS inlinks', async () => {
        const { byPath, analysed } = await crawl('/spa', { renderJs: true, concurrency: 2 });
        expect(byPath.get('/spa')).toMatchObject({ uniqueJsOutlinks: 1, uniqueExternalJsOutlinks: 0 });
        expect(analysed('/spa/child')).toMatchObject({ inlinks: 1, uniqueInlinks: 1, uniqueJsInlinks: 1 });

        // Links in the served HTML aren't JS links in browser mode.
        const plain = await crawl('/a', { renderJs: true, maxDepth: 1 });
        expect(plain.byPath.get('/a')!.uniqueJsOutlinks).toBe(0);
        expect(plain.analysed('/a/deep')).toMatchObject({ uniqueInlinks: 1, uniqueJsInlinks: 0 });
    });

    it('fast HTML mode does not see JavaScript-rendered content (for comparison)', async () => {
        const { byPath, paths } = await crawl('/spa', { renderJs: false });
        expect(byPath.get('/spa')).toMatchObject({ title: '', h1Count: 0 });
        expect(paths).not.toContain('/spa/child');
    });

    it('reports 404s as results and applies depth limits in browser mode too', async () => {
        const { byPath, paths } = await crawl('/', { renderJs: true, maxDepth: 1, concurrency: 3 });
        expect(byPath.get('/missing')).toMatchObject({ status: 404, error: null });
        expect(paths).not.toContain('/a/deep');
        expect(requested).not.toContain('/private/secret');
    });

    it('sends the configured User-Agent, or a real-browser one when it is empty', async () => {
        await crawl('/a', { renderJs: true, maxDepth: 0, userAgent: 'Mozilla/5.0 (compatible; TestBot/1.0)' });
        expect(userAgents.get('/a')).toBe('Mozilla/5.0 (compatible; TestBot/1.0)');

        await crawl('/a', { renderJs: true, maxDepth: 0, userAgent: '' });
        expect(userAgents.get('/a')).toMatch(/Chrome\//);
        expect(userAgents.get('/a')).not.toMatch(/Headless/);
    });

    it('reports response details and HTTP redirects in browser mode too', async () => {
        const details = await crawl('/docs/guide/page', { renderJs: true, maxDepth: 0 });
        expect(details.byPath.get('/docs/guide/page')).toMatchObject({
            statusText: 'OK',
            httpVersion: '1.1',
            lastModified: 'Tue, 01 Sep 2026 10:00:00 GMT',
            cookies: 'session, consent',
            sizeBytes: Buffer.byteLength(DETAILS_BODY),
            hash: createHash('md5').update(DETAILS_BODY).digest('hex'),
        });

        const chain = await crawl('/chain', { renderJs: true });
        expect(chain.byPath.get('/chain')).toMatchObject({ status: 302, redirectUrl: `${origin}/redirect`, redirectType: 'HTTP Redirect', title: '' });
        expect(chain.byPath.get('/redirect')).toMatchObject({ status: 301, redirectUrl: `${origin}/c` });
        expect(chain.byPath.get('/c')).toMatchObject({ status: 200, title: 'C' });
    });

    it('reports the page transferred bytes, and Total Transferred including every resource, with the cache off', async () => {
        // One at a time, so /weight/b loads after /weight/a has already fetched the shared CSS and image.
        const { byPath } = await crawl('/weight/a', { renderJs: true, concurrency: 1 });
        const resources = Buffer.byteLength(WEIGHT_CSS) + WEIGHT_PNG.length;
        const a = byPath.get('/weight/a')!;
        expect(a.sizeBytes).toBe(Buffer.byteLength(WEIGHT_A_BODY));
        // The browser counts bytes on the wire, which for this chunked response includes the chunk-size lines (17 bytes).
        expect(a.transferredBytes).toBeGreaterThanOrEqual(WEIGHT_A_GZIP.length);
        expect(a.transferredBytes).toBeLessThan(WEIGHT_A_GZIP.length + 32);
        expect(a.totalTransferredBytes).toBe(a.transferredBytes! + resources);
        expect(a.co2Mg).toBe(co2Milligrams(a.totalTransferredBytes!));
        expect(a.carbonRating).toBe('A+');

        const b = byPath.get('/weight/b')!;
        expect(b.transferredBytes).toBeGreaterThanOrEqual(b.sizeBytes!);
        // Counted again although /weight/a cached them.
        expect(b.totalTransferredBytes).toBe(b.transferredBytes! + resources);
        expect(requested.filter((p) => p === '/weight/style.css')).toHaveLength(2);
    });

    it.each([
        ['/meta-refresh', 'Meta Refresh Redirect', 'Moving'],
        ['/refresh-header', 'HTTP Refresh Redirect', 'Refresh header'],
        ['/js-redirect', 'JavaScript Redirect', 'JS redirect'],
    ])('keeps %s on its own content (no navigation mid-extraction) and reports a %s', async (path, redirectType, title) => {
        const { byPath } = await crawl(path, { renderJs: true, concurrency: 2 });
        expect(byPath.get(path)).toMatchObject({
            status: 200,
            title,
            redirectType,
            redirectUrl: `${origin}/c`,
            indexable: false,
            indexabilityReason: 'Redirected',
            error: null,
        });
        expect(byPath.get('/c')).toMatchObject({ status: 200, title: 'C' });
    });

    it('reports files and statuses the browser cannot show as a page like fast mode does, not as errors', async () => {
        const { byPath } = await crawl('/files', { renderJs: true });
        // Chromium shows an image in a page of its own (titled "pixel.png (1×1)"); that isn't the site's content.
        expect(byPath.get('/files/pixel.png')).toMatchObject({
            status: 200,
            contentType: 'image/png',
            title: '',
            imagesMissingAlt: 0,
            indexable: true,
            error: null,
        });
        // Downloads (PDF, unknown Content-Type) and a 204 fail in the browser, so they're fetched over HTTP.
        expect(byPath.get('/files/doc.pdf')).toMatchObject({
            status: 200,
            contentType: 'application/pdf',
            indexabilityReason: 'noindex (X-Robots-Tag)',
            error: null,
        });
        expect(byPath.get('/files/odd')).toMatchObject({ status: 200, contentType: 'abc/xyz; charset=UTF-8', error: null });
        expect(byPath.get('/files/empty')).toMatchObject({ status: 204, statusText: 'No Content', error: null });
        expect(byPath.get('/files/to-image')).toMatchObject({ status: 301, redirectUrl: `${origin}/files/moved.png` });
        expect(byPath.get('/files/moved.png')).toMatchObject({ status: 200, title: '', error: null });
        // Fetched once over HTTP, not retried in the browser first.
        expect(requested.filter((p) => p === '/files/doc.pdf')).toHaveLength(2);
    });

    it('reports a redirect loop as a redirect in browser mode too', async () => {
        const { byPath } = await crawl('/loop', { renderJs: true });
        expect(byPath.get('/loop')).toMatchObject({ status: 302, redirectUrl: `${origin}/loop`, redirectType: 'HTTP Redirect', error: null });
    });

    it('does not report history.pushState as a redirect', async () => {
        const { byPath, paths } = await crawl('/push-state', { renderJs: true, maxDepth: 0 });
        expect(byPath.get('/push-state')).toMatchObject({ status: 200, title: 'Push state', redirectUrl: null, redirectType: '', indexable: true });
        expect(paths).toEqual(['/push-state']);
    });

    it('reports a challenge page as blocked in browser mode too', async () => {
        const { byPath, paths } = await crawl('/challenge', { renderJs: true });
        expect(byPath.get('/challenge')).toMatchObject({ status: 200, indexabilityReason: 'Blocked' });
        expect(paths).toEqual(['/challenge']);
    });
});
