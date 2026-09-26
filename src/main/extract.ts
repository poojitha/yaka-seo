import type { CheerioRoot } from 'crawlee';
import type { PageResult } from '@shared/types';

type SeoFields = Omit<PageResult, 'url' | 'finalUrl' | 'status' | 'contentType' | 'depth' | 'responseTimeMs' | 'error'>;

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Pulls the on-page SEO fields out of a parsed HTML document. */
export function extractSeo($: CheerioRoot, pageUrl: string, status: number | null, xRobotsTag: string): SeoFields {
    const title = clean($('head > title').first().text());
    const metaDescription = clean($('meta[name="description" i]').attr('content'));
    const metaRobots = clean($('meta[name="robots" i]').attr('content')).toLowerCase();
    const canonicalHref = $('link[rel="canonical" i]').attr('href');
    const canonical = canonicalHref ? resolveUrl(canonicalHref, pageUrl) ?? canonicalHref : '';

    const h1s = $('h1');
    const bodyText = clean($('body').clone().find('script, style, noscript, template').remove().end().text());
    const wordCount = bodyText ? bodyText.split(' ').length : 0;

    const pageHost = new URL(pageUrl).hostname;
    let internalLinks = 0;
    let externalLinks = 0;
    $('a[href]').each((_, el) => {
        const abs = resolveUrl($(el).attr('href')!, pageUrl);
        if (!abs || !/^https?:/.test(abs)) return;
        if (new URL(abs).hostname === pageHost) internalLinks++;
        else externalLinks++;
    });

    const imagesMissingAlt = $('img').filter((_, el) => !clean($(el).attr('alt'))).length;

    const { indexable, indexabilityReason } = getIndexability(status, metaRobots, xRobotsTag.toLowerCase(), canonical, pageUrl);

    return {
        title,
        titleLength: title.length,
        metaDescription,
        metaDescriptionLength: metaDescription.length,
        h1: clean(h1s.first().text()),
        h1Count: h1s.length,
        h2Count: $('h2').length,
        canonical,
        metaRobots,
        indexable,
        indexabilityReason,
        wordCount,
        internalLinks,
        externalLinks,
        imagesMissingAlt,
    };
}

function getIndexability(status: number | null, metaRobots: string, xRobots: string, canonical: string, pageUrl: string) {
    if (status !== null && (status < 200 || status >= 300)) return { indexable: false, indexabilityReason: `Status ${status}` };
    if (metaRobots.includes('noindex') || metaRobots.includes('none')) return { indexable: false, indexabilityReason: 'noindex (meta)' };
    if (xRobots.includes('noindex') || xRobots.includes('none')) return { indexable: false, indexabilityReason: 'noindex (X-Robots-Tag)' };
    if (canonical && normalize(canonical) !== normalize(pageUrl)) return { indexable: false, indexabilityReason: 'Canonicalised' };
    return { indexable: true, indexabilityReason: '' };
}

function resolveUrl(href: string, base: string): string | null {
    try {
        const u = new URL(href, base);
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}

const normalize = (u: string) => u.replace(/\/+$/, '');
