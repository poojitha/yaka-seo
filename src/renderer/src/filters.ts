import type { PageResult } from '@shared/types';

const isHtml = (r: PageResult) => r.error === null && (r.contentType ?? '').includes('html');

/** Issue filters shown as tabs above the results table. */
export const FILTERS: { id: string; label: string; test: (r: PageResult) => boolean }[] = [
    { id: 'all', label: 'All', test: () => true },
    { id: 'errors', label: '4xx / 5xx / Failed', test: (r) => r.error !== null || (r.status ?? 0) >= 400 },
    { id: 'redirects', label: 'Redirected', test: (r) => r.redirectUrl !== null },
    { id: 'noindex', label: 'Non-indexable', test: (r) => !r.indexable },
    { id: 'title-missing', label: 'Title missing', test: (r) => isHtml(r) && r.titleLength === 0 },
    { id: 'title-long', label: 'Title > 60 chars', test: (r) => r.titleLength > 60 },
    // Pixel limits are Screaming Frog's defaults for where Google's desktop results cut text off.
    { id: 'title-wide', label: 'Title > 561 px', test: (r) => r.titlePixelWidth > 561 },
    { id: 'desc-missing', label: 'Meta desc missing', test: (r) => isHtml(r) && r.metaDescriptionLength === 0 },
    { id: 'desc-long', label: 'Meta desc > 155', test: (r) => r.metaDescriptionLength > 155 },
    { id: 'desc-wide', label: 'Meta desc > 985 px', test: (r) => r.metaDescriptionPixelWidth > 985 },
    { id: 'h1-missing', label: 'H1 missing', test: (r) => isHtml(r) && r.h1Count === 0 },
    { id: 'h1-multiple', label: 'Multiple H1', test: (r) => r.h1Count > 1 },
    { id: 'thin', label: 'Thin (< 200 words)', test: (r) => isHtml(r) && r.wordCount < 200 },
    // Filled in when the crawl ends, so this tab stays empty until then.
    { id: 'near-duplicates', label: 'Near duplicates', test: (r) => (r.nearDuplicates ?? 0) > 0 },
    { id: 'img-alt', label: 'Images missing alt', test: (r) => r.imagesMissingAlt > 0 },
];
