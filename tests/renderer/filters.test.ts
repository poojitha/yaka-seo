import { describe, expect, it } from 'vitest';
import { makeResult } from '../fixtures';
import type { PageResult } from '@shared/types';
import { FILTERS, filterContext } from '../../src/renderer/src/filters';

const filter = (id: string) => FILTERS.find((f) => f.id === id)!;
// A page that passes every check, including the dropdown-only ones (title/description length, canonical).
const healthy: Partial<PageResult> = { title: 'A page title of a healthy length', titleLength: 32, metaDescriptionLength: 120, canonical: 'https://example.com/' };
const matches = (id: string, overrides: Partial<PageResult>) => {
    const row = makeResult({ ...healthy, ...overrides });
    return filter(id).test(row, filterContext([row]));
};
/** Which of `rows` (by URL) match the filter, with the context built from all of them. */
const matching = (id: string, rows: PageResult[]) => {
    const ctx = filterContext(rows);
    return rows.filter((r) => filter(id).test(r, ctx)).map((r) => r.url);
};
const page = (path: string, overrides: Partial<PageResult> = {}) => makeResult({ ...healthy, url: `https://example.com${path}`, canonical: `https://example.com${path}`, ...overrides });
const redirect = (from: string, to: string, status = 301) => page(from, { status, redirectUrl: `https://example.com${to}`, redirectType: 'HTTP Redirect', contentType: null, indexable: false });

const failedRow: Partial<PageResult> = { status: null, contentType: null, error: 'ECONNREFUSED', titleLength: 0, metaDescriptionLength: 0, h1Count: 0, wordCount: 0 };
const pdfRow: Partial<PageResult> = { contentType: 'application/pdf', titleLength: 0, metaDescriptionLength: 0, h1Count: 0, wordCount: 0 };

describe('FILTERS', () => {
    it('has unique ids and starts with "all"', () => {
        const ids = FILTERS.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids[0]).toBe('all');
    });

    it('a healthy page only matches "all"', () => {
        const row = makeResult(healthy);
        const hits = FILTERS.filter((f) => f.test(row, filterContext([row]))).map((f) => f.id);
        expect(hits).toEqual(['all']);
    });

    it.each([
        // [filter, row overrides, expected]
        ['errors', { status: 404 }, true],
        ['errors', { status: 503 }, true],
        ['errors', failedRow, true],
        ['errors', { status: 301 }, false],
        ['redirects', { redirectUrl: 'https://example.com/new' }, true],
        ['redirects', { redirectUrl: null }, false],
        ['noindex', { indexable: false, indexabilityReason: 'noindex (meta)' }, true],
        ['title-missing', { titleLength: 0 }, true],
        ['title-missing', failedRow, false],
        ['title-missing', pdfRow, false],
        ['title-long', { titleLength: 61 }, true],
        ['title-long', { titleLength: 60 }, false],
        ['desc-missing', { metaDescriptionLength: 0 }, true],
        ['desc-missing', pdfRow, false],
        ['desc-long', { metaDescriptionLength: 156 }, true],
        ['desc-long', { metaDescriptionLength: 155 }, false],
        ['title-wide', { titlePixelWidth: 562 }, true],
        ['title-wide', { titlePixelWidth: 561 }, false],
        ['desc-wide', { metaDescriptionPixelWidth: 986 }, true],
        ['desc-wide', { metaDescriptionPixelWidth: 985 }, false],
        ['h1-missing', { h1Count: 0 }, true],
        ['h1-missing', failedRow, false],
        ['h1-multiple', { h1Count: 2 }, true],
        ['h1-multiple', { h1Count: 1 }, false],
        ['thin', { wordCount: 199 }, true],
        ['thin', { wordCount: 200 }, false],
        ['thin', pdfRow, false],
        ['img-alt', { imagesMissingAlt: 1 }, true],
        ['near-duplicates', { nearDuplicates: 2 }, true],
        ['near-duplicates', { nearDuplicates: 0 }, false],
        ['near-duplicates', { nearDuplicates: null }, false],
        ['title-short', { titleLength: 29 }, true],
        ['title-short', { titleLength: 0 }, false],
        ['desc-short', { metaDescriptionLength: 69 }, true],
        ['canonical-missing', { canonical: '' }, true],
        ['canonical-missing', pdfRow, false],
        ['canonicalised', { canonical: 'https://example.com/other' }, true],
        ['weak-inlinks', { depth: 2, uniqueInlinks: 1 }, true],
        ['weak-inlinks', { depth: 0, uniqueInlinks: 0 }, false],
        ['weak-inlinks', { depth: 2, uniqueInlinks: null }, false],
        ['js-only-inlinks', { uniqueInlinks: 2, uniqueJsInlinks: 2 }, true],
        ['js-only-inlinks', { uniqueInlinks: 2, uniqueJsInlinks: 1 }, false],
        ['js-outlinks', { uniqueJsOutlinks: 3 }, true],
        ['slow', { responseTimeMs: 1001 }, true],
        ['uncompressed', { sizeBytes: 20000, transferredBytes: 20000 }, true],
        ['uncompressed', { sizeBytes: 20000, transferredBytes: 5000 }, false],
        ['uncompressed', { sizeBytes: 800, transferredBytes: 800 }, false],
        ['heavy', { totalTransferredBytes: 4 * 1024 * 1024 }, true],
        ['hard-to-read', { readability: 'Very Hard' }, true],
        ['no-lang', { language: '' }, true],
        ['http-urls', { url: 'http://example.com/' }, true],
        ['severity-error', { status: 404 }, true],
        ['severity-error', { h1Count: 2 }, false],
        ['severity-notice', { h1Count: 2 }, true],
    ] as [string, Partial<PageResult>, boolean][])('%s with %o -> %s', (id, overrides, expected) => {
        expect(matches(id, overrides)).toBe(expected);
    });

    it('finds duplicate content, titles, descriptions and H1s across indexable pages', () => {
        const rows = [
            page('/a', { hash: 'h1', title: 'Same', metaDescription: 'Same desc', h1: 'Same' }),
            page('/b', { hash: 'h1', title: 'Same', metaDescription: 'Other', h1: 'Same' }),
            page('/c', { hash: 'h2', title: 'Same', metaDescription: 'Same desc', h1: 'Unique' }),
            // Non-indexable pages don't compete in search, so their tags don't count as duplicates.
            page('/d', { hash: 'h3', title: 'Unique', metaDescription: 'Other', indexable: false }),
        ];
        expect(matching('dup-hash', rows)).toEqual(['https://example.com/a', 'https://example.com/b']);
        expect(matching('dup-title', rows)).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
        expect(matching('dup-desc', rows)).toEqual(['https://example.com/a', 'https://example.com/c']);
        expect(matching('dup-h1', rows)).toEqual(['https://example.com/a', 'https://example.com/b']);
    });

    it('follows crawled redirect hops to find chains, loops and redirects to errors', () => {
        const rows = [
            redirect('/chain', '/hop'),
            redirect('/hop', '/final'),
            page('/final'),
            redirect('/loop-a', '/loop-b'),
            redirect('/loop-b', '/loop-a'),
            redirect('/gone', '/404'),
            page('/404', { status: 404, indexable: false }),
            redirect('/uncrawled', '/never-seen'),
        ];
        expect(matching('redirect-chain', rows)).toEqual(['https://example.com/chain']);
        expect(matching('redirect-loop', rows)).toEqual(['https://example.com/loop-a', 'https://example.com/loop-b']);
        expect(matching('redirect-broken', rows)).toEqual(['https://example.com/gone']);
    });

    it('flags canonicals that point at a non-200 URL', () => {
        const rows = [
            page('/a', { canonical: 'https://example.com/moved' }),
            redirect('/moved', '/b'),
            page('/b'),
            page('/c', { canonical: 'https://example.com/b' }),
        ];
        expect(matching('canonical-broken', rows)).toEqual(['https://example.com/a']);
    });
});
