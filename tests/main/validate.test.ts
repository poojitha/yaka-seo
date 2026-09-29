import { describe, expect, it } from 'vitest';
import type { CrawlOptions } from '@shared/types';
import { parseCrawlOptions } from '../../src/main/validate';

const valid: CrawlOptions = { startUrl: 'https://example.com/', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true, userAgent: '' };

describe('parseCrawlOptions', () => {
    it('accepts valid options and returns only the known fields', () => {
        expect(parseCrawlOptions({ ...valid, extra: 'ignored' })).toEqual(valid);
        expect(parseCrawlOptions({ ...valid, startUrl: 'http://127.0.0.1:8080/', maxDepth: 0, userAgent: 'MyBot/1.0' })).toMatchObject({ maxDepth: 0 });
    });

    it('rejects non-objects', () => {
        expect(() => parseCrawlOptions(null)).toThrow('Invalid crawl options');
        expect(() => parseCrawlOptions('https://example.com/')).toThrow('Invalid crawl options');
    });

    it('only allows http and https start URLs', () => {
        expect(() => parseCrawlOptions({ ...valid, startUrl: 'not a url' })).toThrow('not a valid URL');
        for (const startUrl of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/', 'chrome://settings']) {
            expect(() => parseCrawlOptions({ ...valid, startUrl })).toThrow('http or https');
        }
    });

    it('requires whole numbers within limits', () => {
        for (const maxPages of [0, -1, 1.5, Number.NaN, Infinity, '10', 1_000_001]) {
            expect(() => parseCrawlOptions({ ...valid, maxPages })).toThrow('maxPages must be a whole number from 1 to 1000000');
        }
        expect(() => parseCrawlOptions({ ...valid, maxDepth: -1 })).toThrow('maxDepth');
        expect(() => parseCrawlOptions({ ...valid, concurrency: 0 })).toThrow('concurrency');
        expect(() => parseCrawlOptions({ ...valid, concurrency: 51 })).toThrow('concurrency');
    });

    it('checks renderJs and userAgent types', () => {
        expect(() => parseCrawlOptions({ ...valid, renderJs: 'yes' })).toThrow('renderJs');
        expect(() => parseCrawlOptions({ ...valid, userAgent: undefined })).toThrow('userAgent must be a string');
    });

    it('rejects User-Agents with control characters or excessive length', () => {
        expect(() => parseCrawlOptions({ ...valid, userAgent: 'Bot\r\nX-Evil: 1' })).toThrow('control characters');
        expect(() => parseCrawlOptions({ ...valid, userAgent: 'Bot\u0000' })).toThrow('control characters');
        expect(() => parseCrawlOptions({ ...valid, userAgent: 'x'.repeat(1001) })).toThrow('at most 1000');
    });
});
