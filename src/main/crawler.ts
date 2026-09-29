import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue, type CheerioRoot, type Request } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
import { detectBotProtection, extractSeo } from './extract';

// Report 4xx/5xx pages as results instead of letting Crawlee treat them as failures and retry.
const HTTP_ERROR_CODES = Array.from({ length: 200 }, (_, i) => 400 + i);

type OnPage = (result: PageResult) => void;

/** Runs one crawl at a time using either a fast HTML crawler or a headless-browser crawler. */
export class SiteCrawler {
    private crawler: CheerioCrawler | PlaywrightCrawler | null = null;
    private busy = false;

    get isRunning() {
        return this.busy;
    }

    async run(options: CrawlOptions, onPage: OnPage): Promise<void> {
        if (this.busy) throw new Error('A crawl is already running');
        // Claimed before the first await; `this.crawler` is only set after setup, so checking it let a second run slip in.
        this.busy = true;
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

        /** `headers` must have lower-case names. */
        const handlePage = async (
            request: Request,
            status: number | null,
            headers: Record<string, string>,
            $: CheerioRoot,
            enqueueLinks: (opts: { strategy: 'same-hostname' }) => Promise<unknown>,
        ) => {
            const contentType = headers['content-type'] ?? null;
            const blockedBy = detectBotProtection(status, headers, $);
            if (blockedBy) {
                // A block/challenge page says nothing about the real page, and its links aren't the site's.
                onPage({
                    ...errorResult(request, `Blocked by bot protection (${blockedBy}). Try another User-Agent, or ask the site owner to allowlist the crawler.`),
                    status,
                    contentType,
                    indexabilityReason: 'Blocked',
                });
                return;
            }
            const url = request.loadedUrl ?? request.url;
            onPage({
                ...baseResult(request),
                status,
                contentType,
                ...extractSeo($, url, status, headers['x-robots-tag'] ?? ''),
                error: null,
            });
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
                    async requestHandler({ request, response, parseWithCheerio, enqueueLinks }) {
                        const $ = await parseWithCheerio();
                        await handlePage(request, response?.status() ?? null, response?.headers() ?? {}, $, enqueueLinks);
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
                    async requestHandler({ request, response, $, enqueueLinks }) {
                        const headers = Object.fromEntries(
                            Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : (v ?? '')]),
                        );
                        await handlePage(request, response.statusCode ?? null, headers, $, enqueueLinks);
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
        this.crawler?.stop('Stopped by user');
    }

    /** Immediate shutdown, used when the app quits. */
    async teardown() {
        await this.crawler?.teardown();
    }
}

function baseResult(request: Request) {
    const startedAt = request.userData.startedAt as number | undefined;
    const loaded = request.loadedUrl;
    return {
        url: request.url,
        finalUrl: loaded && loaded !== request.url ? loaded : null,
        depth: request.crawlDepth,
        responseTimeMs: startedAt ? Date.now() - startedAt : null,
    };
}

function errorResult(request: Request, message: string): PageResult {
    return {
        ...baseResult(request),
        status: null,
        contentType: null,
        title: '',
        titleLength: 0,
        metaDescription: '',
        metaDescriptionLength: 0,
        h1: '',
        h1Count: 0,
        h2Count: 0,
        canonical: '',
        metaRobots: '',
        indexable: false,
        indexabilityReason: 'Error',
        wordCount: 0,
        internalLinks: 0,
        externalLinks: 0,
        imagesMissingAlt: 0,
        error: message.split('\n')[0],
    };
}
