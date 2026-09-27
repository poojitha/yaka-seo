import type { PageResult } from '@shared/types';

/** A healthy HTML page result for tests; override only the fields a test cares about. */
export function makeResult(overrides: Partial<PageResult> = {}): PageResult {
    return {
        url: 'https://example.com/',
        finalUrl: null,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        depth: 0,
        responseTimeMs: 120,
        title: 'Example page',
        titleLength: 12,
        metaDescription: 'A description',
        metaDescriptionLength: 13,
        h1: 'Heading',
        h1Count: 1,
        h2Count: 0,
        canonical: '',
        metaRobots: '',
        indexable: true,
        indexabilityReason: '',
        wordCount: 500,
        internalLinks: 3,
        externalLinks: 1,
        imagesMissingAlt: 0,
        error: null,
        ...overrides,
    };
}
