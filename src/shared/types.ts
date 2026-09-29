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

export type CrawlStatus = 'idle' | 'running' | 'stopping' | 'finished' | 'error';

export interface CrawlProgress {
    status: CrawlStatus;
    crawled: number;
    message?: string;
}

/** API exposed to the renderer by the preload script as `window.api`. */
export interface ScreamingApi {
    startCrawl(options: CrawlOptions): Promise<void>;
    stopCrawl(): Promise<void>;
    exportCsv(rows: PageResult[]): Promise<string | null>;
    onResults(cb: (rows: PageResult[]) => void): () => void;
    onProgress(cb: (progress: CrawlProgress) => void): () => void;
}
