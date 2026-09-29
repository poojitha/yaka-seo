import type { CrawlOptions } from '@shared/types';

// IPC payloads come from the renderer, so main re-checks them instead of trusting the TypeScript types.

const LIMITS = {
    maxPages: [1, 1_000_000],
    maxDepth: [0, 1000],
    concurrency: [1, 50],
} as const;

const MAX_UA_LENGTH = 1000;

function int(value: unknown, name: keyof typeof LIMITS): number {
    const [min, max] = LIMITS[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be a whole number from ${min} to ${max}`);
    }
    return value;
}

/** Returns a clean copy of `input`, or throws an Error whose message is safe to show the user. */
export function parseCrawlOptions(input: unknown): CrawlOptions {
    if (typeof input !== 'object' || input === null) throw new Error('Invalid crawl options');
    const o = input as Record<string, unknown>;

    if (typeof o.startUrl !== 'string') throw new Error('startUrl must be a string');
    let url: URL;
    try {
        url = new URL(o.startUrl);
    } catch {
        throw new Error('startUrl is not a valid URL');
    }
    // Playwright would happily open file: and other local schemes.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('startUrl must be an http or https URL');

    if (typeof o.renderJs !== 'boolean') throw new Error('renderJs must be a boolean');

    if (typeof o.userAgent !== 'string') throw new Error('userAgent must be a string');
    // CR/LF would make every request fail (or inject headers).
    if (/[\x00-\x1f\x7f]/.test(o.userAgent)) throw new Error('userAgent must not contain control characters');
    if (o.userAgent.length > MAX_UA_LENGTH) throw new Error(`userAgent must be at most ${MAX_UA_LENGTH} characters`);

    return {
        startUrl: o.startUrl,
        maxPages: int(o.maxPages, 'maxPages'),
        maxDepth: int(o.maxDepth, 'maxDepth'),
        concurrency: int(o.concurrency, 'concurrency'),
        renderJs: o.renderJs,
        userAgent: o.userAgent,
    };
}
