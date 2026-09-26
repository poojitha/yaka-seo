import { CheerioCrawler, Configuration, PlaywrightCrawler, RequestQueue, type CheerioRoot, type Request } from 'crawlee';
import type { CrawlOptions, PageResult } from '@shared/types';
import { extractSeo } from './extract';

// Report 4xx/5xx pages as results instead of letting Crawlee treat them as failures and retry.
const HTTP_ERROR_CODES = Array.from({ length: 200 }, (_, i) => 400 + i);

type OnPage = (result: PageResult) => void;

/** Runs one crawl at a time using either a fast HTML crawler or a headless-browser crawler. */
export class SiteCrawler {
    private crawler: CheerioCrawler | PlaywrightCrawler | null = null;

    get isRunning() {
        return this.crawler !== null;
    }

    async run(options: CrawlOptions, onPage: OnPage): Promise<void> {
        if (this.crawler) throw new Error('A crawl is already running');

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

        const handlePage = async (
            request: Request,
            status: number | null,
            contentType: string | null,
            xRobotsTag: string,
            $: CheerioRoot,
            enqueueLinks: (opts: { strategy: 'same-hostname' }) => Promise<unknown>,
        ) => {
            const url = request.loadedUrl ?? request.url;
            onPage({
                ...baseResult(request),
                status,
                contentType,
                ...extractSeo($, url, status, xRobotsTag),
                error: null,
            });
            if (status === null || status < 400) await enqueueLinks({ strategy: 'same-hostname' });
        };

        if (options.renderJs) {
            this.crawler = new PlaywrightCrawler(
                {
                    ...shared,
                    headless: true,
                    async requestHandler({ request, response, parseWithCheerio, enqueueLinks }) {
                        const headers = response?.headers() ?? {};
                        const $ = await parseWithCheerio();
                        await handlePage(request, response?.status() ?? null, headers['content-type'] ?? null, headers['x-robots-tag'] ?? '', $, enqueueLinks);
                    },
                },
                config,
            );
        } else {
            this.crawler = new CheerioCrawler(
                {
                    ...shared,
                    ignoreHttpErrorStatusCodes: HTTP_ERROR_CODES,
                    async requestHandler({ request, response, $, enqueueLinks }) {
                        const xRobots = response.headers['x-robots-tag'];
                        await handlePage(
                            request,
                            response.statusCode ?? null,
                            response.headers['content-type'] ?? null,
                            Array.isArray(xRobots) ? xRobots.join(',') : (xRobots ?? ''),
                            $,
                            enqueueLinks,
                        );
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
