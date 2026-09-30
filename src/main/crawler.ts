import { createHash } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue, type CheerioRoot, type Request } from 'crawlee';
import type { Page, Request as BrowserRequest } from 'playwright';
import type { CrawlAnalysis, CrawlOptions, PageResult, PostCrawlFields } from '@shared/types';
import { analyseCrawl, minhashSignature, type CrawledPage } from './analysis';
import { carbonRating, co2Milligrams } from './carbon';
import { contentText, detectBotProtection, extractSeo, linkTargets, refreshTarget, resolveUrl } from './extract';

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
    /** The requested URL's own 3xx response, if the fetch followed HTTP redirects to get here. */
    redirect: RedirectHop | null;
    /** Browser mode: a navigation away from the loaded page (JavaScript, meta refresh) that was blocked, or null. */
    blockedNavigation: string | null;
    /** `<a href>` values in the HTML as served, before JavaScript ran. null in fast HTML mode, where nothing runs. */
    rawHrefs: string[] | null;
}

/** One HTTP redirect: the status and headers of the 3xx response, and where it pointed. */
interface RedirectHop {
    status: number;
    /** Lower-case names. */
    headers: Record<string, string>;
    location: string;
}

/** What the fast HTML mode's got hooks record about a request while it's in flight. */
interface RequestTrace {
    /** Raw (still compressed) body bytes of the final response; null if it wasn't compressed. */
    bytes: number | null;
    /** The first redirect of the request, i.e. the requested URL's own response. */
    redirect: RedirectHop | null;
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

        /** Fast HTML mode: per-request state filled in by got hooks. */
        const traces = new WeakMap<Request, RequestTrace>();

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
                // A redirect loop fails after too many hops, but the URL itself still answered with a redirect.
                const hop = traces.get(request)?.redirect;
                report(hop ? redirectResult(request, hop) : errorResult(request, error.message));
            },
        };

        type EnqueueLinks = (opts: { strategy: 'same-hostname' | 'all'; urls?: string[] }) => Promise<unknown>;
        /** Queues a redirect target, if it's on the crawl's hostname (checked here, since Crawlee compares against the loaded URL). */
        const enqueueTarget = async (request: Request, target: string, enqueueLinks: EnqueueLinks) => {
            if (new URL(target).hostname === new URL(request.url).hostname) await enqueueLinks({ urls: [target], strategy: 'all' });
        };

        const handlePage = async (request: Request, res: PageResponse, $: CheerioRoot, enqueueLinks: EnqueueLinks) => {
            const { status, headers, body } = res;
            // An HTTP redirect is its own row, and only its next hop is queued: the page it leads to is reported as
            // that hop's row, as in Screaming Frog. Also covers a 3xx the client didn't follow (300, 305).
            const hop =
                res.redirect ??
                (status !== null && status >= 300 && status < 400 && headers['location'] ? { status, headers, location: headers['location'] } : null);
            if (hop) {
                const row = redirectResult(request, hop, HTTP_VERSIONS[res.httpVersion.toLowerCase()] ?? res.httpVersion);
                report(row);
                if (row.redirectUrl) await enqueueTarget(request, row.redirectUrl, enqueueLinks);
                return;
            }
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
            const pageUrl = resolveUrl(request.loadedUrl ?? request.url, request.url) ?? request.url;
            const base = baseResult(request);
            const seo = extractSeo($, pageUrl, status, headers, body?.toString('utf8').length);
            // Pages that send the browser elsewhere after loading. A refresh without a URL just reloads the page.
            const refreshHeader = refreshTarget(headers['refresh'] ?? '', pageUrl);
            const metaRefresh = refreshTarget(seo.metaRefresh, pageUrl);
            const [redirectType, redirectUrl] = refreshHeader
                ? ['HTTP Refresh Redirect', refreshHeader]
                : metaRefresh
                  ? ['Meta Refresh Redirect', metaRefresh]
                  : res.blockedNavigation
                    ? ['JavaScript Redirect', res.blockedNavigation]
                    : ['', null];
            const redirectsAway = redirectUrl !== null && redirectUrl !== pageUrl;
            // extractSeo() already treats a refresh elsewhere as a redirect; a JavaScript one is only known here.
            if (redirectsAway && seo.indexable) Object.assign(seo, { indexable: false, indexabilityReason: 'Redirected' });

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
                    redirectUrl,
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
            if (redirectsAway) await enqueueTarget(request, redirectUrl!, enqueueLinks);
        };

        const { userAgent } = options;
        if (options.renderJs) {
            /** Every request each page has finished loading, for Total Transferred. */
            const finishedRequests = new WeakMap<Page, BrowserRequest[]>();
            /** Where each page tried to navigate after loading (meta refresh, JavaScript), for its redirect. */
            const blockedNavigations = new WeakMap<Page, string>();
            /** Resolves when a page's navigation away is blocked; see the post-navigation hook. */
            const navigationBlocked = new WeakMap<Page, Promise<void>>();
            this.crawler = new PlaywrightCrawler(
                {
                    ...shared,
                    headless: true,
                    // Crawlee's fingerprints override the User-Agent, so they're only used for the browser ('') setting.
                    ...(userAgent && { browserPoolOptions: { useFingerprints: false }, launchContext: { userAgent } }),
                    preNavigationHooks: [
                        ...shared.preNavigationHooks,
                        async ({ page }, gotoOptions) => {
                            // goto() returns at commit; the post-navigation hook then waits for load (see there).
                            if (gotoOptions) gotoOptions.waitUntil = 'commit';
                            let onBlocked!: () => void;
                            navigationBlocked.set(page, new Promise<void>((resolve) => (onBlocked = resolve)));
                            const finished: BrowserRequest[] = [];
                            page.on('requestfinished', (r) => finished.push(r));
                            finishedRequests.set(page, finished);
                            // Pages share a browser cache, so CSS/JS fetched by an earlier page would count as 0 bytes.
                            // Total Transferred should be what a first-time visitor downloads.
                            // Chromium only applies setCacheDisabled while the session has the Network domain enabled.
                            const cdp = await page.context().newCDPSession(page);
                            await cdp.send('Network.enable').catch(() => {});
                            await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
                            // Keep the page on the URL being crawled. A meta refresh or JavaScript redirect would
                            // otherwise replace it mid-extraction ("Execution context was destroyed"). The attempt is
                            // recorded as the page's redirect instead, and its target crawled separately.
                            // HTTP redirect hops (redirectedFrom set) are part of the first navigation and pass.
                            let navigated = false;
                            await page.route('**/*', (route) => {
                                const req = route.request();
                                if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !req.redirectedFrom()) {
                                    if (navigated) {
                                        if (!blockedNavigations.has(page)) blockedNavigations.set(page, req.url());
                                        onBlocked();
                                        // 'aborted', not the default 'failed': a failed navigation loads Chromium's
                                        // error page (replacing ours anyway), a cancelled one leaves the page as is.
                                        return route.abort('aborted');
                                    }
                                    navigated = true;
                                }
                                return route.continue();
                            });
                        },
                    ],
                    postNavigationHooks: [
                        async ({ page }) => {
                            // Normally this is the load event, as goto() would wait for. But a script that
                            // navigates while the page is still loading (inline location.replace()) stops the
                            // parser: once that navigation is blocked, load never fires, so stop waiting then.
                            await Promise.race([page.waitForLoadState('load'), navigationBlocked.get(page)]);
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
                            redirect: response ? await firstRedirect(response.request()) : null,
                            blockedNavigation: blockedNavigations.get(page) ?? null,
                            rawHrefs,
                        };
                        await handlePage(request, pageResponse, $, enqueueLinks);
                    },
                },
                config,
            );
        } else {
            this.crawler = new CheerioCrawler(
                {
                    ...shared,
                    ignoreHttpErrorStatusCodes: HTTP_ERROR_CODES,
                    preNavigationHooks: [
                        ...shared.preNavigationHooks,
                        ({ request }, gotOptions) => {
                            if (userAgent) gotOptions.headers = { ...gotOptions.headers, 'user-agent': userAgent };
                            const trace: RequestTrace = { bytes: null, redirect: null };
                            traces.set(request, trace);
                            type Hooks = NonNullable<typeof gotOptions.hooks>;
                            const countBytes = countRawBodyBytes(trace) as unknown as NonNullable<Hooks['beforeRequest']>[number];
                            const recordRedirect = recordFirstRedirect(trace) as unknown as NonNullable<Hooks['beforeRedirect']>[number];
                            gotOptions.hooks = {
                                ...gotOptions.hooks,
                                beforeRequest: [...(gotOptions.hooks?.beforeRequest ?? []), countBytes],
                                beforeRedirect: [...(gotOptions.hooks?.beforeRedirect ?? []), recordRedirect],
                            };
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
                        const transferred = traces.get(request)?.bytes ?? buffer.length;
                        const pageResponse: PageResponse = {
                            status: response.statusCode ?? null,
                            headers,
                            httpVersion: response.httpVersion,
                            body: buffer,
                            transferredBytes: transferred,
                            // Only the HTML is fetched in this mode.
                            totalTransferredBytes: transferred,
                            redirect: traces.get(request)?.redirect ?? null,
                            blockedNavigation: null,
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
    // A #fragment is never sent to the server, so the page is the same URL without it.
    const url = new URL(request.url);
    url.hash = '';
    return {
        url: url.href,
        urlEncoded: url.href,
        depth: request.crawlDepth,
        // Directories only, as in Screaming Frog: '/a/b/' is 2, '/a/b' is 1 ('b' is the page).
        folderDepth: url.pathname.split('/').slice(1, -1).filter(Boolean).length,
        responseTimeMs: startedAt ? Date.now() - startedAt : null,
        crawlTimestamp: new Date().toISOString(),
    };
}

/** The row for a URL that answered with an HTTP redirect: status, headers and where it points, no page content. */
function redirectResult(request: Request, hop: RedirectHop, httpVersion = ''): PageResult {
    return {
        ...errorResult(request, ''),
        redirectUrl: resolveUrl(hop.location, request.url),
        redirectType: 'HTTP Redirect',
        status: hop.status,
        statusText: STATUS_CODES[hop.status] ?? '',
        contentType: hop.headers['content-type'] ?? null,
        httpVersion,
        lastModified: hop.headers['last-modified'] ?? '',
        indexabilityReason: 'Redirected',
        error: null,
    };
}

/** Browser mode: the first request's 3xx response, if the navigation followed HTTP redirects to `final`. */
async function firstRedirect(final: BrowserRequest): Promise<RedirectHop | null> {
    let first = final;
    while (first.redirectedFrom()) first = first.redirectedFrom()!;
    if (first === final) return null;
    const response = await first.response().catch(() => null);
    if (!response) return null;
    return {
        status: response.status(),
        headers: (await response.allHeaders().catch(() => null)) ?? response.headers(),
        location: first.redirectedTo()?.url() ?? response.headers()['location'] ?? '',
    };
}

/** got `beforeRedirect` hook (fast HTML mode) that records the first redirect: the requested URL's own response. */
function recordFirstRedirect(trace: RequestTrace) {
    return (options: { url?: URL | string }, response: { statusCode: number; headers: Record<string, string | string[] | undefined> }) => {
        if (trace.redirect) return;
        const headers = Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : (v ?? '')]));
        trace.redirect = { status: response.statusCode, headers, location: String(options.url ?? headers['location'] ?? '') };
    };
}

type RequestFunction = (...args: unknown[]) => unknown;
type ClientRequestLike = NodeJS.EventEmitter & { res?: NodeJS.EventEmitter | null };

/**
 * got `beforeRequest` hook that counts a response's body bytes as received, before decompression (fast HTML mode).
 * got-scraping swaps a compressed response for a decompressing stream before got sees it, so got's own byte counts
 * are of decompressed data. The raw response is still reachable as the ClientRequest's `res`, and it's already
 * flowing (piped into the decompressor), so listening to its data changes nothing. Uncompressed responses are left
 * alone: got reads those in paused mode, and a data listener would take the data from it.
 * Runs after got-scraping's own hooks, so it wraps the request function that is actually used (HTTP/1.1 or HTTP/2).
 */
function countRawBodyBytes(counter: RequestTrace) {
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
        redirectUrl: null,
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
