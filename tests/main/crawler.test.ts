import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { log } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
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
};

beforeAll(async () => {
    // Keep Crawlee from writing ./storage and from logging every request.
    process.env.CRAWLEE_STORAGE_DIR = mkdtempSync(join(tmpdir(), 'screamingai-test-'));
    log.setLevel(log.LEVELS.OFF);

    server = createServer(async (req, res) => {
        const path = new URL(req.url!, 'http://x').pathname;
        if (path !== '/robots.txt') requested.push(path);
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
});

const defaults: Omit<CrawlOptions, 'startUrl'> = { maxPages: 100, maxDepth: 10, concurrency: 5, renderJs: false };

async function crawl(path: string, options: Partial<CrawlOptions> = {}, crawler = new SiteCrawler()) {
    const rows: PageResult[] = [];
    await crawler.run({ ...defaults, startUrl: origin + path, ...options }, (r) => rows.push(r));
    const byPath = new Map(rows.map((r) => [new URL(r.url).pathname, r]));
    return { rows, byPath, paths: [...byPath.keys()].sort() };
}

describe('SiteCrawler (fast HTML mode)', () => {
    it('crawls every in-scope page and reports each exactly once', async () => {
        const { rows, paths } = await crawl('/');
        expect(paths).toEqual(['/', '/a', '/a/deep', '/a/deep/deeper', '/b', '/broken', '/missing', '/redirect', '/xrobots']);
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
            finalUrl: null,
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

    it('follows redirects and records the final URL', async () => {
        const { byPath } = await crawl('/');
        expect(byPath.get('/redirect')).toMatchObject({ status: 200, finalUrl: `${origin}/c`, title: 'C' });
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
        [2, ['/', '/a', '/a/deep', '/b', '/broken', '/missing', '/redirect', '/xrobots']],
    ])('Depth %i limits how far links are followed', async (maxDepth, expected) => {
        const { paths } = await crawl('/', { maxDepth });
        expect(paths).toEqual(expected);
    });

    it.each([1, 3, 5])('Max pages %i caps the number of results', async (maxPages) => {
        const { rows } = await crawl('/', { maxPages });
        expect(rows).toHaveLength(maxPages);
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
});

describe('SiteCrawler (Render JavaScript mode)', () => {
    it('sees content and links that only exist after JavaScript runs', async () => {
        const { byPath, paths } = await crawl('/spa', { renderJs: true, concurrency: 2 });
        expect(byPath.get('/spa')).toMatchObject({ status: 200, title: 'Rendered title', h1: 'Hello', h1Count: 1 });
        expect(paths).toContain('/spa/child');
        expect(byPath.get('/spa/child')!.title).toBe('Child');
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
});
