import { createHash } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue, type CheerioRoot, type Request } from 'crawlee';
import type { Page, Request as BrowserRequest } from 'playwright';
import type { CrawlAnalysis, CrawlOptions, PageResult, PostCrawlFields } from '@shared/types';
import { analyseCrawl, minhashSignature, type CrawledPage } from './analysis';
import { carbonRating, co2Milligrams } from './carbon';
import { contentText, detectBotProtection, extractSeo, linkTargets } from './extract';

// Report 4xx/5xx pages as results instead of letting Crawlee treat them as failures and retry.
const HTTP_ERROR_CODES = Array.from({ length: 200 }, (_, i) => 400 + i);

type OnPage = (result: PageResult) => void;

/** What each crawler mode reads from its own response type. */
interface PageResponse {
    status: number | null;
    /** Lower-case names; multiple `Set-Cookie` headers joined with '\n' (Playwright's convention). */
    headers: Record<string, string>;
    /** As reported: '1.1', '2.0', 'h2', 'http/1.1'... */
    httpVersion: string;
    body: Buffer | null;
    transferredBytes: number | null;
    totalTransferredBytes: number | null;
    /** Whether a redirect to `request.loadedUrl` was an HTTP 3xx (otherwise it was JavaScript). */
    redirectedByHttp: boolean;
    /** `<a href>` values in the HTML as served, before JavaScript ran. null in fast HTML mode, where nothing runs. */
    rawHrefs: string[] | null;
}

/** Rows are sent before the crawl ends, when the post-crawl fields aren't known yet. */
const NOT_ANALYSED: PostCrawlFields = {
    inlinks: null,
    uniqueInlinks: null,
    uniqueJsInlinks: null,
    percentOfTotal: null,
    linkScore: null,
    closestNearDuplicate: '',
    closestNearDuplicateSimilarity: null,
    nearDuplicates: null,
};

/** Minimal DOMParser typing for code that runs inside the page (main's tsconfig has no DOM types). */
type BrowserGlobals = {
    DOMParser: new () => {
        parseFromString(html: string, type: string): { querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }> };
    };
};

const HTTP_VERSIONS: Record<string, string> = { 'http/1.0': '1.0', 'http/1.1': '1.1', h2: '2', '2.0': '2', h3: '3' };

/** Runs one crawl at a time using either a fast HTML crawler or a headless-browser crawler. */
export class SiteCrawler {
    private crawler: CheerioCrawler | PlaywrightCrawler | null = null;
    private busy = false;
    /** Set by stop()/teardown(); covers the setup window before `this.crawler` exists. */
    private stopRequested = false;

    get isRunning() {
        return this.busy;
    }

    /**
     * Crawls, reporting each page through `onPage` as it's done. Resolves when the crawl ends (finished or stopped)
     * with the post-crawl analysis of every reported page.
     */
    async run(options: CrawlOptions, onPage: OnPage): Promise<CrawlAnalysis> {
        if (this.busy) throw new Error('A crawl is already running');
        // Claimed before the first await; `this.crawler` is only set after setup, so checking it let a second run slip in.
        this.busy = true;
        this.stopRequested = false;
        try {
            return await this.crawl(options, onPage);
        } finally {
            this.busy = false;
        }
    }

    private async crawl(options: CrawlOptions, onPage: OnPage): Promise<CrawlAnalysis> {
        // Fresh in-memory storage per crawl so a previous crawl's queue doesn't mark URLs as already handled.
        const config = new Configuration({ persistStorage: false, purgeOnStart: true });
        const requestQueue = await RequestQueue.open(`crawl-${Date.now()}`, { config });
        // A Stop that arrived while the queue was opening would otherwise be lost (there was no crawler to stop yet).
        if (this.stopRequested) {
            await requestQueue.drop().catch(() => {});
            return {};
        }

        // Link targets and text fingerprints for the post-crawl analysis. Kept here, not in the rows, so they
        // aren't sent to the renderer.
        const pages: CrawledPage[] = [];
        const report = (row: PageResult, page: Partial<CrawledPage> = {}) => {
            pages.push({ url: row.url, isHtml200: false, links: [], jsLinks: new Set(), signature: null, ...page });
            onPage(row);
        };

        const shared = {
            requestQueue,
            maxRequestsPerCrawl: options.maxPages,
            maxCrawlDepth: options.maxDepth,
            maxConcurrency: options.concurrency,
            maxRequestRetries: 1,
            useSessionPool: false,
            respectRobotsTxtFile: true,
            preNavigationHooks: [
                ({ request }: { request: Request }) => {
                    request.userData.startedAt = Date.now();
                },
            ],
            failedRequestHandler: ({ request }: { request: Request }, error: Error) => {
                report(errorResult(request, error.message));
            },
        };

        const handlePage = async (
            request: Request,
            res: PageResponse,
            $: CheerioRoot,
            enqueueLinks: (opts: { strategy: 'same-hostname' }) => Promise<unknown>,
        ) => {
            const { status, headers, body } = res;
            const co2Mg = res.totalTransferredBytes === null ? null : co2Milligrams(res.totalTransferredBytes);
            const response = {
                status,
                statusText: (status !== null && STATUS_CODES[status]) || '',
                contentType: headers['content-type'] ?? null,
                httpVersion: HTTP_VERSIONS[res.httpVersion.toLowerCase()] ?? res.httpVersion,
                lastModified: headers['last-modified'] ?? '',
                sizeBytes: body?.length ?? null,
                transferredBytes: res.transferredBytes,
                totalTransferredBytes: res.totalTransferredBytes,
                co2Mg,
                // Only meaningful when the total includes the page's resources, which needs JS mode.
                carbonRating: co2Mg !== null && options.renderJs ? carbonRating(co2Mg) : '',
                hash: body ? createHash('md5').update(body).digest('hex') : '',
            };
            const blockedBy = detectBotProtection(status, headers, $);
            if (blockedBy) {
                // A block/challenge page says nothing about the real page, and its links aren't the site's.
                report({
                    ...errorResult(request, `Blocked by bot protection (${blockedBy}). Try another User-Agent, or ask the site owner to allowlist the crawler.`),
                    ...response,
                    indexabilityReason: 'Blocked',
                });
                return;
            }
            const pageUrl = request.loadedUrl ?? request.url;
            const base = baseResult(request);
            const seo = extractSeo($, pageUrl, status, headers);
            const redirectType = base.finalUrl
                ? res.redirectedByHttp
                    ? 'HTTP Redirect'
                    : 'JavaScript Redirect'
                : /url\s*=/i.test(seo.metaRefresh)
                  ? 'Meta Refresh'
                  : '';

            const links = linkTargets(
                $('a[href]')
                    .map((_, el) => $(el).attr('href')!)
                    .get(),
                pageUrl,
            );
            // A link in the rendered page that the served HTML doesn't have was added by JavaScript.
            const served = res.rawHrefs && new Set(Object.values(linkTargets(res.rawHrefs, pageUrl)).flat());
            const jsOnly = (targets: string[]) => new Set(served ? targets.filter((t) => !served.has(t)) : []);
            const jsInternal = jsOnly(links.internal);
            const followed = status === null || status < 400;

            report(
                {
                    ...base,
                    redirectType,
                    ...response,
                    ...seo,
                    uniqueJsOutlinks: jsInternal.size,
                    uniqueExternalJsOutlinks: jsOnly(links.external).size,
                    ...NOT_ANALYSED,
                    error: null,
                },
                {
                    isHtml200: status === 200 && /html/i.test(response.contentType ?? ''),
                    // Same rule as enqueueing: a 4xx/5xx page's links aren't followed, so they don't count as inlinks.
                    links: followed ? links.internal : [],
                    jsLinks: jsInternal,
                    // Only indexable pages are checked for near duplicates, as in Screaming Frog by default.
                    signature: seo.indexable ? minhashSignature(contentText($)) : null,
                },
            );
            if (followed) await enqueueLinks({ strategy: 'same-hostname' });
        };

        const { userAgent } = options;
        if (options.renderJs) {
            /** Every request each page has finished loading, for Total Transferred. */
            const finishedRequests = new WeakMap<Page, BrowserRequest[]>();
            this.crawler = new PlaywrightCrawler(
                {
                    ...shared,
                    headless: true,
                    // Crawlee's fingerprints override the User-Agent, so they're only used for the browser ('') setting.
                    ...(userAgent && { browserPoolOptions: { useFingerprints: false }, launchContext: { userAgent } }),
                    preNavigationHooks: [
                        ...shared.preNavigationHooks,
                        async ({ page }) => {
                            const finished: BrowserRequest[] = [];
                            page.on('requestfinished', (r) => finished.push(r));
                            finishedRequests.set(page, finished);
                            // Pages share a browser cache, so CSS/JS fetched by an earlier page would count as 0 bytes.
                            // Total Transferred should be what a first-time visitor downloads.
                            // Chromium only applies setCacheDisabled while the session has the Network domain enabled.
                            const cdp = await page.context().newCDPSession(page);
                            await cdp.send('Network.enable').catch(() => {});
                            await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
                        },
                    ],
                    async requestHandler({ request, response, page, parseWithCheerio, enqueueLinks }) {
                        const $ = await parseWithCheerio();
                        // Playwright's Response doesn't expose the protocol; Navigation Timing does ('h2', 'http/1.1').
                        const httpVersion = await page
                            .evaluate(() => (performance.getEntriesByType('navigation')[0] as { nextHopProtocol?: string } | undefined)?.nextHopProtocol ?? '')
                            .catch(() => '');
                        const bodySize = (r: BrowserRequest) =>
                            r
                                .sizes()
                                // Negative for a cached response (Playwright subtracts header size from 0 bytes on the wire).
                                .then((s) => Math.max(0, s.responseBodySize))
                                .catch(() => 0);
                        // Resources still loading when the handler runs (after the load event) aren't counted.
                        const resourceSizes = await Promise.all((finishedRequests.get(page) ?? []).map(bodySize));
                        const body = (await response?.body().catch(() => null)) ?? null;
                        // Parse the served HTML with the browser's own parser, so no HTML library is needed in main.
                        const rawHrefs = body
                            ? await page
                                  .evaluate((html) => {
                                      const doc = new (globalThis as unknown as BrowserGlobals).DOMParser().parseFromString(html, 'text/html');
                                      return Array.from(doc.querySelectorAll('a[href]'), (a) => a.getAttribute('href') ?? '');
                                  }, body.toString('utf8'))
                                  .catch(() => null)
                            : null;
                        const pageResponse: PageResponse = {
                            status: response?.status() ?? null,
                            // allHeaders(), not headers(): the latter omits Set-Cookie.
                            headers: (await response?.allHeaders().catch(() => null)) ?? response?.headers() ?? {},
                            httpVersion,
                            body,
                            transferredBytes: response ? await bodySize(response.request()) : null,
                            totalTransferredBytes: resourceSizes.reduce((a, b) => a + b, 0),
                            redirectedByHttp: !!response?.request().redirectedFrom(),
                            rawHrefs,
                        };
                        await handlePage(request, pageResponse, $, enqueueLinks);
                    },
                },
                config,
            );
        } else {
            const rawBodyBytes = new WeakMap<Request, ByteCounter>();
            this.crawler = new CheerioCrawler(
                {
                    ...shared,
                    ignoreHttpErrorStatusCodes: HTTP_ERROR_CODES,
                    preNavigationHooks: [
                        ...shared.preNavigationHooks,
                        ({ request }, gotOptions) => {
                            if (userAgent) gotOptions.headers = { ...gotOptions.headers, 'user-agent': userAgent };
                            const counter: ByteCounter = { bytes: null };
                            rawBodyBytes.set(request, counter);
                            const hook = countRawBodyBytes(counter) as unknown as NonNullable<NonNullable<typeof gotOptions.hooks>['beforeRequest']>[number];
                            gotOptions.hooks = { ...gotOptions.hooks, beforeRequest: [...(gotOptions.hooks?.beforeRequest ?? []), hook] };
                        },
                    ],
                    async requestHandler({ request, response, body, $, enqueueLinks }) {
                        const headers = Object.fromEntries(
                            Object.entries(response.headers).map(([k, v]) => [
                                k.toLowerCase(),
                                // Set-Cookie values contain commas (Expires=...), so they're joined with '\n' like Playwright does.
                                Array.isArray(v) ? v.join(k.toLowerCase() === 'set-cookie' ? '\n' : ',') : (v ?? ''),
                            ]),
                        );
                        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
                        // Uncompressed responses aren't counted: the body as received is the body.
                        const transferred = rawBodyBytes.get(request)?.bytes ?? buffer.length;
                        const pageResponse: PageResponse = {
                            status: response.statusCode ?? null,
                            headers,
                            httpVersion: response.httpVersion,
                            body: buffer,
                            transferredBytes: transferred,
                            // Only the HTML is fetched in this mode.
                            totalTransferredBytes: transferred,
                            // No JavaScript runs in this mode, so any redirect was HTTP.
                            redirectedByHttp: true,
                            rawHrefs: null,
                        };
                        await handlePage(request, pageResponse, $, enqueueLinks);
                    },
                },
                config,
            );
        }

        try {
            await this.crawler.run([{ url: options.startUrl }]);
        } finally {
            this.crawler = null;
            await requestQueue.drop().catch(() => {});
        }
        return analyseCrawl(pages);
    }

    /** Graceful stop: in-flight requests finish, nothing new is started. */
    stop() {
        if (!this.busy) return;
        this.stopRequested = true;
        this.crawler?.stop('Stopped by user');
    }

    /** Immediate shutdown, used when the app quits. */
    async teardown() {
        if (!this.busy) return;
        this.stopRequested = true;
        // stop() too, in case the crawler is still starting up and has no pool for teardown() to abort yet.
        this.crawler?.stop('App closing');
        await this.crawler?.teardown();
    }
}

function baseResult(request: Request) {
    const startedAt = request.userData.startedAt as number | undefined;
    const loaded = request.loadedUrl;
    const url = new URL(request.url);
    return {
        url: request.url,
        urlEncoded: url.href,
        finalUrl: loaded && loaded !== request.url ? loaded : null,
        depth: request.crawlDepth,
        folderDepth: url.pathname.split('/').filter(Boolean).length,
        responseTimeMs: startedAt ? Date.now() - startedAt : null,
        crawlTimestamp: new Date().toISOString(),
    };
}

type RequestFunction = (...args: unknown[]) => unknown;
type ClientRequestLike = NodeJS.EventEmitter & { res?: NodeJS.EventEmitter | null };

/** Raw (still compressed) body bytes of the final response; null if it wasn't compressed. */
type ByteCounter = { bytes: number | null };

/**
 * got `beforeRequest` hook that counts a response's body bytes as received, before decompression (fast HTML mode).
 * got-scraping swaps a compressed response for a decompressing stream before got sees it, so got's own byte counts
 * are of decompressed data. The raw response is still reachable as the ClientRequest's `res`, and it's already
 * flowing (piped into the decompressor), so listening to its data changes nothing. Uncompressed responses are left
 * alone: got reads those in paused mode, and a data listener would take the data from it.
 * Runs after got-scraping's own hooks, so it wraps the request function that is actually used (HTTP/1.1 or HTTP/2).
 */
function countRawBodyBytes(counter: ByteCounter) {
    return (options: { request?: RequestFunction; getRequestFunction(): RequestFunction | undefined }) => {
        const original = options.getRequestFunction();
        if (!original) return;
        const watch = (req: ClientRequestLike) => {
            // Once per response, so after a redirect only the final response counts.
            req.on('response', (response: unknown) => {
                const raw = req.res;
                counter.bytes = null;
                if (!raw || raw === response) return;
                counter.bytes = 0;
                raw.on('data', (chunk: Buffer) => {
                    counter.bytes! += chunk.length;
                });
            });
            return req;
        };
        // The HTTP/2 request function returns a promise of the request.
        options.request = (...args) => {
            const req = original(...args);
            return req instanceof Promise ? req.then(watch) : watch(req as ClientRequestLike);
        };
    };
}

function errorResult(request: Request, message: string): PageResult {
    return {
        ...baseResult(request),
        redirectType: '',
        status: null,
        statusText: '',
        contentType: null,
        httpVersion: '',
        lastModified: '',
        cookies: '',
        sizeBytes: null,
        transferredBytes: null,
        totalTransferredBytes: null,
        co2Mg: null,
        carbonRating: '',
        hash: '',
        title: '',
        titleLength: 0,
        titlePixelWidth: 0,
        metaDescription: '',
        metaDescriptionLength: 0,
        metaDescriptionPixelWidth: 0,
        metaKeywords: '',
        metaKeywordsLength: 0,
        h1: '',
        h1Length: 0,
        h1Second: '',
        h1SecondLength: 0,
        h1Count: 0,
        h2: '',
        h2Length: 0,
        h2Count: 0,
        canonical: '',
        metaRobots: '',
        metaRobots2: '',
        xRobotsTag: '',
        metaRefresh: '',
        relNext: '',
        relPrev: '',
        httpRelNext: '',
        httpRelPrev: '',
        amphtml: '',
        mobileAlternate: '',
        language: '',
        indexable: false,
        indexabilityReason: 'Error',
        wordCount: 0,
        sentenceCount: 0,
        avgWordsPerSentence: null,
        fleschReadingEase: null,
        readability: '',
        textRatio: 0,
        internalLinks: 0,
        uniqueInternalLinks: 0,
        externalLinks: 0,
        uniqueExternalLinks: 0,
        uniqueJsOutlinks: 0,
        uniqueExternalJsOutlinks: 0,
        imagesMissingAlt: 0,
        ...NOT_ANALYSED,
        error: message.split('\n')[0],
    };
}
