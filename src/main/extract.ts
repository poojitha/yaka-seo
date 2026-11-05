import type { CheerioRoot } from 'crawlee';
import type { PageResult, PostCrawlFields } from '@shared/types';
import { DESCRIPTION_FONT_PX, pixelWidth, TITLE_FONT_PX } from './pixel-width';

/** Fields that don't come from the HTML and headers; the crawler fills these in. */
type ResponseFields =
    | 'url'
    | 'urlEncoded'
    | 'redirectUrl'
    | 'redirectType'
    | 'status'
    | 'statusText'
    | 'contentType'
    | 'httpVersion'
    | 'lastModified'
    | 'depth'
    | 'folderDepth'
    | 'responseTimeMs'
    | 'crawlTimestamp'
    | 'sizeBytes'
    | 'transferredBytes'
    | 'totalTransferredBytes'
    | 'co2Mg'
    | 'carbonRating'
    | 'hash'
    | 'uniqueJsOutlinks'
    | 'uniqueExternalJsOutlinks'
    | keyof PostCrawlFields
    | 'error';
type SeoFields = Omit<PageResult, ResponseFields>;

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// Sentences also end at these, so a heading, list item or table cell without a full stop isn't merged with the next.
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const BLOCKS = 'address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul';

/**
 * Pulls the on-page SEO fields out of a parsed HTML document and its response headers.
 * `headers` must have lower-case names; multiple `Set-Cookie` headers are joined with '\n'.
 * `rawHtmlLength` is the length of the HTML as served; Text Ratio is measured against it, not the (possibly
 * JavaScript-grown) parsed document.
 */
export function extractSeo($: CheerioRoot, pageUrl: string, status: number | null, headers: Record<string, string>, rawHtmlLength?: number): SeoFields {
    // Link elements only count in <head>, as for search engines: a canonical or rel=next in <body> is ignored.
    const href = (selector: string) => {
        const h = $(`head ${selector}`).first().attr('href');
        return h ? resolveUrl(h, pageUrl) ?? h : '';
    };

    const title = clean($('head > title').first().text());
    const metaDescription = clean($('meta[name="description" i]').attr('content'));
    const metaKeywords = clean($('meta[name="keywords" i]').attr('content'));
    // Googlebot-specific directives apply to Google just like generic robots ones.
    const robotsTags = $('meta[name="robots" i], meta[name="googlebot" i]')
        .map((_, el) => clean($(el).attr('content')).toLowerCase())
        .get();
    const xRobotsTag = headers['x-robots-tag'] ?? '';
    const linkHeader = headers['link'] ?? '';
    // An HTML canonical wins; otherwise one sent as `Link: <url>; rel="canonical"`.
    const canonical = href('link[rel="canonical" i]') || linkHeaderUrl(linkHeader, 'canonical', pageUrl);
    const metaRefresh = clean($('meta[http-equiv="refresh" i]').attr('content'));
    // A refresh (meta tag or HTTP header) to another URL is a redirect; one without a URL just reloads the page.
    const refreshTo = refreshTarget(metaRefresh, pageUrl) || refreshTarget(headers['refresh'] ?? '', pageUrl);

    const h1s = $('h1');
    const h1 = clean(h1s.eq(0).text());
    const h1Second = clean(h1s.eq(1).text());
    const h2 = clean($('h2').first().text());

    const text = visibleText($);
    const bodyText = clean(text);
    const words = bodyText ? bodyText.split(' ') : [];
    const sentenceCount = text.split(/[.!?]+(?=\s|$)|\p{Zp}/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
    const htmlLength = rawHtmlLength ?? $.html().length;

    const links = linkTargets(
        $('a[href]')
            .map((_, el) => $(el).attr('href')!)
            .get(),
        pageUrl,
    );

    const imagesMissingAlt = $('img').filter((_, el) => !clean($(el).attr('alt'))).length;

    const { indexable, indexabilityReason } = getIndexability(status, robotsTags.join(', '), xRobotsTag.toLowerCase(), canonical, refreshTo, pageUrl);
    const flesch = fleschReadingEase(words, sentenceCount);

    return {
        cookies: (headers['set-cookie'] ?? '')
            .split('\n')
            .map((c) => c.split('=')[0].trim())
            .filter(Boolean)
            .join(', '),
        title,
        titleLength: title.length,
        titlePixelWidth: pixelWidth(title, TITLE_FONT_PX),
        metaDescription,
        metaDescriptionLength: metaDescription.length,
        metaDescriptionPixelWidth: pixelWidth(metaDescription, DESCRIPTION_FONT_PX),
        metaKeywords,
        metaKeywordsLength: metaKeywords.length,
        h1,
        h1Length: h1.length,
        h1Second,
        h1SecondLength: h1Second.length,
        h1Count: h1s.length,
        h2,
        h2Length: h2.length,
        h2Count: $('h2').length,
        canonical,
        metaRobots: robotsTags[0] ?? '',
        metaRobots2: robotsTags[1] ?? '',
        xRobotsTag,
        metaRefresh,
        relNext: href('link[rel~="next" i]'),
        relPrev: href('link[rel~="prev" i]'),
        httpRelNext: linkHeaderUrl(linkHeader, 'next', pageUrl),
        httpRelPrev: linkHeaderUrl(linkHeader, 'prev', pageUrl),
        amphtml: href('link[rel~="amphtml" i]'),
        mobileAlternate: href('link[rel~="alternate" i][media]'),
        language: clean($('html').attr('lang')),
        indexable,
        indexabilityReason,
        wordCount: words.length,
        sentenceCount,
        avgWordsPerSentence: sentenceCount ? round(words.length / sentenceCount) : null,
        fleschReadingEase: flesch,
        readability: flesch === null ? '' : readabilityBand(flesch),
        textRatio: htmlLength ? round((bodyText.length / htmlLength) * 100) : 0,
        internalLinks: links.internal.length,
        uniqueInternalLinks: new Set(links.internal).size,
        externalLinks: links.external.length,
        uniqueExternalLinks: new Set(links.external).size,
        imagesMissingAlt,
    };
}

/**
 * Splits `<a href>` values into internal (same hostname as the page) and external http(s) targets: absolute, without
 * #fragment, one entry per link. mailto:, tel:, javascript: and unparseable hrefs are dropped.
 */
export function linkTargets(hrefs: string[], pageUrl: string): { internal: string[]; external: string[] } {
    const pageHost = new URL(pageUrl).hostname;
    const internal: string[] = [];
    const external: string[] = [];
    for (const h of hrefs) {
        const abs = resolveUrl(h, pageUrl);
        if (!abs || !/^https?:/.test(abs)) continue;
        (new URL(abs).hostname === pageHost ? internal : external).push(abs);
    }
    return { internal, external };
}

/** The page's visible body text as one whitespace-collapsed string. */
export const contentText = ($: CheerioRoot) => clean(visibleText($));

/**
 * Body text without scripts and styles. A paragraph separator (U+2029) follows each block element: unlike '\n'
 * it doesn't occur in ordinary source formatting, and `clean()` still treats it as whitespace.
 */
function visibleText($: CheerioRoot): string {
    const body = $('body').clone();
    body.find('script, style, noscript, template').remove();
    body.find(BLOCKS).after(PARAGRAPH_SEPARATOR);
    return body.text();
}

/** Standard Flesch reading ease. The formula and syllable counting are English-specific. */
function fleschReadingEase(words: string[], sentences: number): number | null {
    const counted = words.filter((w) => /[a-z]/i.test(w));
    if (counted.length === 0 || sentences === 0) return null;
    const syllables = counted.reduce((sum, w) => sum + countSyllables(w), 0);
    const score = 206.835 - 1.015 * (counted.length / sentences) - 84.6 * (syllables / counted.length);
    // The formula can leave 0-100 (one short word, or very long polysyllabic sentences); the scale is 0-100.
    return round(Math.min(100, Math.max(0, score)));
}

/** Heuristic syllable count: vowel groups, ignoring a silent final e/es/ed. */
function countSyllables(word: string): number {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    const groups = w
        .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
        .replace(/^y/, '')
        .match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups?.length ?? 0);
}

// The standard Flesch reading ease bands and names.
function readabilityBand(score: number): string {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Normal';
    if (score >= 50) return 'Fairly Hard';
    if (score >= 30) return 'Hard';
    return 'Very Hard';
}

/** First URL in an HTTP `Link` header whose rel includes `rel`, e.g. `<https://a/2>; rel="next"`. */
function linkHeaderUrl(header: string, rel: string, base: string): string {
    for (const [, url, params] of header.matchAll(/<([^>]*)>([^<]*)/g)) {
        const rels = /;\s*rel\s*=\s*"?([^";]+)"?/i.exec(params)?.[1].toLowerCase().split(/\s+/) ?? [];
        if (rels.includes(rel)) return resolveUrl(url, base) ?? url;
    }
    return '';
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Recognises CDN bot-protection responses (block pages and JS challenges), which would otherwise be
 * reported as real pages; Akamai serves its challenge with status 200. Returns the vendor, or null.
 * `headers` must have lower-case names.
 */
export function detectBotProtection(status: number | null, headers: Record<string, string>, $: CheerioRoot): string | null {
    const server = (headers['server'] ?? '').toLowerCase();
    const blockedStatus = status === 403 || status === 429 || status === 503;

    if ($('#sec-if-cpt-container, #sec-cpt-if').length > 0) return 'Akamai';
    if (blockedStatus && server.includes('akamai')) return 'Akamai';

    if (headers['cf-mitigated'] === 'challenge') return 'Cloudflare';
    // Not the challenge-platform script alone: Cloudflare also injects it into normal pages.
    if ($('#challenge-form').length > 0 || (blockedStatus && clean($('head > title').first().text()) === 'Just a moment...')) return 'Cloudflare';
    if (blockedStatus && server === 'cloudflare') return 'Cloudflare';

    return null;
}

function getIndexability(status: number | null, metaRobots: string, xRobots: string, canonical: string, refreshTo: string, pageUrl: string) {
    const self = resolveUrl(pageUrl, pageUrl) ?? pageUrl;
    if (status !== null && status >= 300 && status < 400) return { indexable: false, indexabilityReason: 'Redirected' };
    if (status !== null && (status < 200 || status >= 300)) return { indexable: false, indexabilityReason: `Status ${status}` };
    if (metaRobots.includes('noindex') || metaRobots.includes('none')) return { indexable: false, indexabilityReason: 'noindex (meta)' };
    if (xRobots.includes('noindex') || xRobots.includes('none')) return { indexable: false, indexabilityReason: 'noindex (X-Robots-Tag)' };
    if (refreshTo && refreshTo !== self) return { indexable: false, indexabilityReason: 'Redirected' };
    // Exact comparison, as search engines do: /page and /page/ are different URLs.
    if (canonical && canonical !== self) return { indexable: false, indexabilityReason: 'Canonicalised' };
    return { indexable: true, indexabilityReason: '' };
}

/**
 * Where a refresh directive (`<meta http-equiv="refresh">` content or a `Refresh` header) sends the browser:
 * the absolute URL after `url=`, the page itself for a plain reload ('5'), or '' if there's no directive.
 */
export function refreshTarget(content: string, pageUrl: string): string {
    if (!content.trim()) return '';
    const url = /url\s*=\s*['"]?([^'"]*)/i.exec(content)?.[1].trim();
    return resolveUrl(url || pageUrl, pageUrl) ?? '';
}

/** Absolute URL without #fragment, or null if `href` can't be parsed. */
export function resolveUrl(href: string, base: string): string | null {
    try {
        const u = new URL(href, base);
        u.hash = '';
        return u.href;
    } catch {
        return null;
    }
}
