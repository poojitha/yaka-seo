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
    /** Percent-encoded form of `url`. */
    urlEncoded: string;
    /** Final URL after redirects, if different from `url`. */
    finalUrl: string | null;
    /** 'HTTP Redirect' or 'JavaScript Redirect' when `finalUrl` is set, 'Meta Refresh' when the page asks to redirect, else ''. */
    redirectType: string;
    status: number | null;
    /** Standard reason phrase for `status`, e.g. 'Not Found'. */
    statusText: string;
    contentType: string | null;
    /** HTTP protocol version: '1.1', '2' or '3'. */
    httpVersion: string;
    /** `Last-Modified` response header. */
    lastModified: string;
    /** Names of the cookies set by `Set-Cookie` response headers, comma-separated. */
    cookies: string;
    depth: number;
    /** Non-empty path segments: '/' is 0, '/blog/post' is 2. */
    folderDepth: number;
    responseTimeMs: number | null;
    /** ISO 8601 time the page was processed. */
    crawlTimestamp: string;
    /** Uncompressed size of the response body. */
    sizeBytes: number | null;
    /** Response body bytes as sent over the network (compressed, if the server compressed it; headers excluded). */
    transferredBytes: number | null;
    /**
     * In JS mode, `transferredBytes` summed over the page and every resource it loaded (CSS, JS, images, fonts...),
     * measured with the browser cache off. In fast HTML mode only the HTML is fetched, so this equals `transferredBytes`.
     */
    totalTransferredBytes: number | null;
    /** Estimated CO2e per page view from `totalTransferredBytes` (Sustainable Web Design Model v4). */
    co2Mg: number | null;
    /**
     * A+ to F from `co2Mg`. JS mode only: in fast HTML mode the total covers just the HTML, so nearly every page
     * would rate A+.
     */
    carbonRating: string;
    /** MD5 of the response body; equal hashes mean exact duplicate pages. */
    hash: string;
    title: string;
    titleLength: number;
    /** Width in Google's desktop results (Arial 20 px); titles over about 561 px get cut off. */
    titlePixelWidth: number;
    metaDescription: string;
    metaDescriptionLength: number;
    /** Width in Google's desktop results (Arial 14 px); descriptions over about 985 px get cut off. */
    metaDescriptionPixelWidth: number;
    metaKeywords: string;
    metaKeywordsLength: number;
    h1: string;
    h1Length: number;
    /** Text of the second H1, if there is one. */
    h1Second: string;
    h1SecondLength: number;
    h1Count: number;
    /** Text of the first H2. */
    h2: string;
    h2Length: number;
    h2Count: number;
    canonical: string;
    /** First and second `<meta name="robots">` tags; indexability considers both. */
    metaRobots: string;
    metaRobots2: string;
    /** `X-Robots-Tag` response header. */
    xRobotsTag: string;
    /** `content` of `<meta http-equiv="refresh">`, e.g. '0; url=/new'. */
    metaRefresh: string;
    /** Absolute URLs from `<link rel="next|prev">` and the HTTP `Link` header. */
    relNext: string;
    relPrev: string;
    httpRelNext: string;
    httpRelPrev: string;
    /** Absolute URL of `<link rel="amphtml">`. */
    amphtml: string;
    /** Absolute URL of `<link rel="alternate" media="...">` (separate mobile site). */
    mobileAlternate: string;
    /** `<html lang>` attribute. */
    language: string;
    indexable: boolean;
    indexabilityReason: string;
    wordCount: number;
    sentenceCount: number;
    /** null when the page has no text. */
    avgWordsPerSentence: number | null;
    /** Flesch reading ease (English formula): higher is easier; 60-70 is plain English. null when the page has no text. */
    fleschReadingEase: number | null;
    /** Band for `fleschReadingEase`, e.g. 'Normal' or 'Difficult'. */
    readability: string;
    /** Visible text characters as a percentage of the HTML's characters. */
    textRatio: number;
    internalLinks: number;
    uniqueInternalLinks: number;
    externalLinks: number;
    uniqueExternalLinks: number;
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
