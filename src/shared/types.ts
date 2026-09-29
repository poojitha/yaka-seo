export interface CrawlOptions {
    startUrl: string;
    maxPages: number;
    maxDepth: number;
    concurrency: number;
    /** Use headless Chromium (Playwright) to render JavaScript before extracting. */
    renderJs: boolean;
    /** User-Agent header to send. '' means a generated real-browser (Chrome) fingerprint. */
    userAgent: string;
}

export interface PageResult {
    url: string;
    /** Final URL after redirects, if different from `url`. */
    finalUrl: string | null;
    status: number | null;
    contentType: string | null;
    depth: number;
    responseTimeMs: number | null;
    title: string;
    titleLength: number;
    metaDescription: string;
    metaDescriptionLength: number;
    h1: string;
    h1Count: number;
    h2Count: number;
    canonical: string;
    metaRobots: string;
    indexable: boolean;
    indexabilityReason: string;
    wordCount: number;
    internalLinks: number;
    externalLinks: number;
    imagesMissingAlt: number;
    error: string | null;
}

/** 'stopping' and 'stopped' are sent by main after a Stop request; 'finished' means the crawl ran to completion. */
export type CrawlStatus = 'idle' | 'running' | 'stopping' | 'stopped' | 'finished' | 'error';

export interface CrawlProgress {
    status: CrawlStatus;
    crawled: number;
    message?: string;
}

/** IPC channel names, shared by main and preload so the two sides can't drift apart. */
export const IPC = {
    startCrawl: 'crawl:start',
    stopCrawl: 'crawl:stop',
    exportCsv: 'export:csv',
    results: 'crawl:results',
    progress: 'crawl:progress',
} as const;

/** API exposed to the renderer by the preload script as `window.api`. */
export interface ScreamingApi {
    startCrawl(options: CrawlOptions): Promise<void>;
    stopCrawl(): Promise<void>;
    exportCsv(rows: PageResult[]): Promise<string | null>;
    onResults(cb: (rows: PageResult[]) => void): () => void;
    onProgress(cb: (progress: CrawlProgress) => void): () => void;
}
