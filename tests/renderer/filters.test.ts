import { describe, expect, it } from 'vitest';
import { makeResult } from '../fixtures';
import type { PageResult } from '@shared/types';
import { FILTERS } from '../../src/renderer/src/filters';

const matches = (id: string, overrides: Partial<PageResult>) => FILTERS.find((f) => f.id === id)!.test(makeResult(overrides));

const failedRow: Partial<PageResult> = { status: null, contentType: null, error: 'ECONNREFUSED', titleLength: 0, metaDescriptionLength: 0, h1Count: 0, wordCount: 0 };
const pdfRow: Partial<PageResult> = { contentType: 'application/pdf', titleLength: 0, metaDescriptionLength: 0, h1Count: 0, wordCount: 0 };

describe('FILTERS', () => {
    it('has unique ids and starts with "all"', () => {
        const ids = FILTERS.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids[0]).toBe('all');
    });

    it('a healthy page only matches "all"', () => {
        const hits = FILTERS.filter((f) => f.test(makeResult())).map((f) => f.id);
        expect(hits).toEqual(['all']);
    });

    it.each([
        // [filter, row overrides, expected]
        ['errors', { status: 404 }, true],
        ['errors', { status: 503 }, true],
        ['errors', failedRow, true],
        ['errors', { status: 301 }, false],
        ['redirects', { finalUrl: 'https://example.com/new' }, true],
        ['redirects', { finalUrl: null }, false],
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
    ] as [string, Partial<PageResult>, boolean][])('%s with %o -> %s', (id, overrides, expected) => {
        expect(matches(id, overrides)).toBe(expected);
    });
});
