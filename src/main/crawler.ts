import { createHash } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue, type CheerioRoot, type Request } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
import { detectBotProtection, extractSeo } from './extract';

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
    /** Whether a redirect to `request.loadedUrl` was an HTTP 3xx (otherwise it was JavaScript). */
    redirectedByHttp: boolean;
}

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

    async run(options: CrawlOptions, onPage: OnPage): Promise<void> {
        if (this.busy) throw new Error('A crawl is already running');
        // Claimed before the first await; `this.crawler` is only set after setup, so checking it let a second run slip in.
        this.busy = true;
        this.stopRequested = false;
        try {
            await this.crawl(options, onPage);
        } finally {
            this.busy = false;
        }
    }

    private async crawl(options: CrawlOptions, onPage: OnPage): Promise<void> {
        // Fresh in-memory storage per crawl so a previous crawl's queue doesn't mark URLs as already handled.
        const config = new Configuration({ persistStorage: false, purgeOnStart: true });
        const requestQueue = await RequestQueue.open(`crawl-${Date.now()}`, { config });
        // A Stop that arrived while the queue was opening would otherwise be lost (there was no crawler to stop yet).
        if (this.stopRequested) {
            await requestQueue.drop().catch(() => {});
            return;
        }

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
                onPage(errorResult(request, error.message));
            },
        };

        const handlePage = async (
            request: Request,
            res: PageResponse,
            $: CheerioRoot,
            enqueueLinks: (opts: { strategy: 'same-hostname' }) => Promise<unknown>,
        ) => {
            const { status, headers, body } = res;
            const response = {
                status,
                statusText: (status !== null && STATUS_CODES[status]) || '',
                contentType: headers['content-type'] ?? null,
                httpVersion: HTTP_VERSIONS[res.httpVersion.toLowerCase()] ?? res.httpVersion,
                lastModified: headers['last-modified'] ?? '',
                sizeBytes: body?.length ?? null,
                hash: body ? createHash('md5').update(body).digest('hex') : '',
            };
            const blockedBy = detectBotProtection(status, headers, $);
            if (blockedBy) {
                // A block/challenge page says nothing about the real page, and its links aren't the site's.
                onPage({
                    ...errorResult(request, `Blocked by bot protection (${blockedBy}). Try another User-Agent, or ask the site owner to allowlist the crawler.`),
                    ...response,
                    indexabilityReason: 'Blocked',
                });
                return;
            }
            const base = baseResult(request);
            const seo = extractSeo($, request.loadedUrl ?? request.url, status, headers);
            const redirectType = base.finalUrl
                ? res.redirectedByHttp
                    ? 'HTTP Redirect'
                    : 'JavaScript Redirect'
                : /url\s*=/i.test(seo.metaRefresh)
                  ? 'Meta Refresh'
                  : '';
            onPage({ ...base, redirectType, ...response, ...seo, error: null });
            if (status === null || status < 400) await enqueueLinks({ strategy: 'same-hostname' });
        };

        const { userAgent } = options;
        if (options.renderJs) {
            this.crawler = new PlaywrightCrawler(
                {
                    ...shared,
                    headless: true,
                    // Crawlee's fingerprints override the User-Agent, so they're only used for the browser ('') setting.
                    ...(userAgent && { browserPoolOptions: { useFingerprints: false }, launchContext: { userAgent } }),
                    async requestHandler({ request, response, page, parseWithCheerio, enqueueLinks }) {
                        const $ = await parseWithCheerio();
                        // Playwright's Response doesn't expose the protocol; Navigation Timing does ('h2', 'http/1.1').
                        const httpVersion = await page
                            .evaluate(() => (performance.getEntriesByType('navigation')[0] as { nextHopProtocol?: string } | undefined)?.nextHopProtocol ?? '')
                            .catch(() => '');
                        const pageResponse: PageResponse = {
                            status: response?.status() ?? null,
                            // allHeaders(), not headers(): the latter omits Set-Cookie.
                            headers: (await response?.allHeaders().catch(() => null)) ?? response?.headers() ?? {},
                            httpVersion,
                            body: (await response?.body().catch(() => null)) ?? null,
                            redirectedByHttp: !!response?.request().redirectedFrom(),
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
                        (_ctx, gotOptions) => {
                            if (userAgent) gotOptions.headers = { ...gotOptions.headers, 'user-agent': userAgent };
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
                        const pageResponse: PageResponse = {
                            status: response.statusCode ?? null,
                            headers,
                            httpVersion: response.httpVersion,
                            body: Buffer.isBuffer(body) ? body : Buffer.from(body),
                            // No JavaScript runs in this mode, so any redirect was HTTP.
                            redirectedByHttp: true,
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
        hash: '',
        title: '',
        titleLength: 0,
        metaDescription: '',
        metaDescriptionLength: 0,
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
        imagesMissingAlt: 0,
        error: message.split('\n')[0],
    };
}
