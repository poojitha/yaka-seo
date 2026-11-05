/*
 * Yaka test site: a local website where every page carries a known SEO problem (or none), together with the
 * issue filters the crawler should flag for it. Run it with `npm run testsite` and crawl it in the app, or let
 * `npm run test:e2e` crawl it in both modes and compare every row against CASES.
 *
 * Layout: every page has a nav to Home, the sitemap and the section indexes; each case is linked from its section
 * index and from /sitemap, so it has two inlinks unless it says otherwise (`listed`).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';

type Respond = (req: IncomingMessage, res: ServerResponse, origin: string) => void | Promise<void>;

/** What the crawler should report for one URL. Mode overrides (`fast`, `js`) replace the matching keys. */
export interface Expectation {
    /** Exact set of issue filter ids (see ISSUES in filters.ts) the row should match. */
    filters?: string[];
    /** Fields the row must have: equal values, or a RegExp a string field must match. */
    fields?: Record<string, unknown>;
    /** false: the URL must not appear in the crawl (robots.txt, out of scope, links from error pages...). */
    crawled?: boolean;
}

export interface Case extends Expectation {
    path: string;
    /** Short human name: the default H1 and the start of the default title. Unique across the site. */
    name: string;
    section: SectionId;
    respond: Respond;
    /** Where the case is linked from: its section index and /sitemap ('both', default), the index only, or nowhere. */
    listed?: 'both' | 'section' | 'none';
    fast?: Expectation;
    js?: Expectation;
    /** Why the expectation is what it is, shown in the manual checklist. */
    note?: string;
}

export type Mode = 'fast' | 'js';

/** The expectation for a case in one crawl mode. */
export function expectationFor(c: Case, mode: Mode): Required<Pick<Expectation, 'filters' | 'crawled'>> & Expectation {
    const merged = { filters: [], crawled: true, ...pick(c), ...c[mode] };
    return { ...merged, filters: [...merged.filters].sort() };
}
const pick = ({ filters, fields, crawled }: Expectation): Expectation =>
    Object.fromEntries(Object.entries({ filters, fields, crawled }).filter(([, v]) => v !== undefined));

/** Filters ignored when comparing: every URL on a local http:// site is "Non-HTTPS". */
export const IGNORED_FILTERS = ['http-urls'];

// ---------------------------------------------------------------------------------------------------------------
// Text: unique, easy-to-read filler per page, so clean pages aren't thin, near duplicates or hard to read.

const WORDS = (
    'the a red big small old new green blue cat dog bird fish tree park road shop town house room door book cup ' +
    'sun moon rain wind snow hill lake boat car bus train map key box bag hat coat shoe bed lamp desk pen card ' +
    'cake bread milk tea jam egg rice soup salt corn bean seed leaf rose farm barn cow hen pig goat sheep horse ' +
    'walks runs sits eats reads sees finds takes keeps makes gives holds pulls pushes opens shuts fills lifts ' +
    'near by on in at with from past under over and then but so here there now soon late fast slow warm cold ' +
    'kind calm bright dark soft hard clean wet dry tall short wide long full'
).split(' ');

/** Small deterministic PRNG (mulberry32), seeded from a string. */
function rng(seed: string) {
    let h = 1779033703;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    return () => {
        h = (h + 0x6d2b79f5) | 0;
        let t = Math.imul(h ^ (h >>> 15), 1 | h);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** About `words` words of short sentences built from `seed`; the same seed always gives the same text. */
export function article(seed: string, words = 230): string {
    const next = rng(seed);
    const sentences: string[] = [];
    let count = 0;
    while (count < words) {
        const len = 8 + Math.floor(next() * 5);
        const s = Array.from({ length: len }, () => WORDS[Math.floor(next() * WORDS.length)]);
        s[0] = s[0][0].toUpperCase() + s[0].slice(1);
        sentences.push(s.join(' ') + '.');
        count += len;
    }
    return `<p>${sentences.join(' ')}</p>`;
}

const HARD_TEXT = Array.from(
    { length: 12 },
    (_, i) =>
        `Notwithstanding considerable organisational complexity, interdepartmental communication methodologies ` +
        `necessitate comprehensive institutionalisation of standardised documentation procedures, particularly ` +
        `regarding infrastructural modernisation initiatives and administrative responsibilities number ${i}.`,
).join(' ');

// ---------------------------------------------------------------------------------------------------------------
// Pages

export const SITE_NAME = 'Yaka SEO crawler test site';

const SECTIONS = {
    status: 'Status codes',
    redirects: 'Redirects',
    indexability: 'Indexability',
    titles: 'Page titles',
    descriptions: 'Meta descriptions',
    headings: 'Headings',
    content: 'Content',
    images: 'Images and files',
    links: 'Internal links',
    performance: 'Performance',
    bot: 'Bot protection',
    robust: 'Edge cases',
} as const;
export type SectionId = keyof typeof SECTIONS;

const sectionPath = (id: SectionId) => `/${id}/`;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const link = (href: string, text: string) => `<a href="${href}">${escapeHtml(text)}</a>`;
const nav = () =>
    `<nav>${[link('/', 'Home'), link('/sitemap', 'Sitemap'), ...Object.entries(SECTIONS).map(([id, label]) => link(sectionPath(id as SectionId), label))].join(' | ')}</nav>`;

interface PageSpec {
    name: string;
    /** null: no <title> element. Default: `${name} | ${SITE_NAME}`. */
    title?: string | null;
    /** null: no meta description. */
    description?: string | null;
    /** null: no <h1>; an array: one <h1> per entry. Default: name. */
    h1?: string | string[] | null;
    /** null: none; a string: used as given (relative or absolute). Default: the page's own absolute URL. */
    canonical?: string | null;
    /** null: no lang attribute. */
    lang?: string | null;
    /** Replaces the generated article. */
    text?: string;
    /** Seed for the generated article (default: the path). */
    seed?: string;
    words?: number;
    head?: string;
    /** Extra HTML after the H1. */
    body?: string;
    status?: number;
    headers?: Record<string, string>;
    /** Serve gzip-compressed when the client accepts it (default true). */
    gzip?: boolean;
    delayMs?: number;
}

const defaultDescription = (name: string) => `Test page for ${name.toLowerCase()} on the ${SITE_NAME}, built to check each crawler report.`;

function renderPage(spec: PageSpec, path: string, origin: string): string {
    const title = spec.title === undefined ? `${spec.name} | ${SITE_NAME}` : spec.title;
    const description = spec.description === undefined ? defaultDescription(spec.name) : spec.description;
    const h1s = spec.h1 === undefined ? [spec.name] : spec.h1 === null ? [] : [spec.h1].flat();
    const canonical = spec.canonical === undefined ? origin + path : spec.canonical;
    const lang = spec.lang === undefined ? 'en' : spec.lang;
    const head = [
        '<meta charset="utf-8">',
        title === null ? '' : `<title>${escapeHtml(title)}</title>`,
        description === null ? '' : `<meta name="description" content="${escapeHtml(description)}">`,
        canonical === null ? '' : `<link rel="canonical" href="${escapeHtml(canonical)}">`,
        spec.head ?? '',
    ].join('');
    const body = [
        `<header>${nav()}</header><main>`,
        h1s.map((h) => `<h1>${escapeHtml(h)}</h1>`).join(''),
        spec.body ?? '',
        spec.text ?? article(spec.seed ?? path, spec.words),
        '</main>',
    ].join('');
    return `<!doctype html><html${lang === null ? '' : ` lang="${lang}"`}><head>${head}</head><body>${body}</body></html>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(req: IncomingMessage, res: ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer, gzip = true) {
    let data = typeof body === 'string' ? Buffer.from(body) : body;
    const out: Record<string, string> = { ...headers };
    if (gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
        data = gzipSync(data);
        out['content-encoding'] = 'gzip';
    }
    out['content-length'] = String(data.length);
    res.writeHead(status, out);
    res.end(req.method === 'HEAD' ? undefined : data);
}

const page =
    (spec: PageSpec): Respond =>
    async (req, res, origin) => {
        if (spec.delayMs) await sleep(spec.delayMs);
        const path = new URL(req.url ?? '/', origin).pathname;
        send(req, res, spec.status ?? 200, { 'content-type': 'text/html; charset=utf-8', ...spec.headers }, renderPage(spec, path, origin), spec.gzip ?? true);
    };

const redirect =
    (status: number, to: string): Respond =>
    (_req, res) => {
        res.writeHead(status, { location: to, 'content-length': '0' });
        res.end();
    };

const file =
    (contentType: string, body: () => Buffer, headers: Record<string, string> = {}): Respond =>
    (req, res) =>
        send(req, res, 200, { 'content-type': contentType, ...headers }, body(), false);

/** A typical error page: nav, a heading and a line of text, no description or canonical. */
const errorPage = (status: number, name: string, extraBody = ''): Respond =>
    page({ name, status, description: null, canonical: null, text: `<p>Sorry, something went wrong (${status}).</p>${extraBody}` });

// A valid 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
// A script, not an image: Chromium stops downloading an image it can't decode. Random base64 in a comment,
// served uncompressed, so it really is 3.5 MB on the wire.
let heavyScript: Buffer | null = null;
const heavy = () => (heavyScript ??= Buffer.from(`/* ${randomBytes(2.6 * 1024 * 1024).toString('base64')} */`));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

// Exact duplicates must be byte-identical, so they can't carry a self canonical.
const EXACT_DUP: PageSpec = { name: 'Exact duplicate', canonical: null, seed: 'exact-duplicate' };
const NEAR_DUP_TEXT = article('near-duplicate');
// One word changed: about 95% similar with 5-word shingles, over the 90% threshold.
const NEAR_DUP_TEXT_2 = NEAR_DUP_TEXT.replace(/^<p>\w+/, '<p>Zebra');

const BODY_REDIRECT_TEXT = '<p>Redirecting you to the new page.</p>';

/* The non-content filters an error or redirect row matches: Non-indexable, plus its own. */
const ERROR = ['errors', 'noindex'];
const REDIRECT = ['redirects', 'noindex'];

export const CASES: Case[] = [
    // --- Status codes ---------------------------------------------------------------------------------------
    { section: 'status', path: '/status/ok', name: 'Healthy 200 page', respond: page({ name: 'Healthy 200 page' }), fields: { status: 200, indexable: true } },
    {
        section: 'status',
        path: '/status/not-found',
        name: 'Missing page',
        respond: errorPage(404, 'Missing page', link('/status/never-linked', 'Link on a 404 page')),
        filters: ERROR,
        fields: { status: 404 },
        note: 'Content checks (thin, missing description...) should not apply to error pages.',
    },
    { section: 'status', path: '/status/never-linked', name: 'Only linked from a 404', respond: page({ name: 'Only linked from a 404' }), listed: 'none', crawled: false, note: 'Links on 4xx pages must not be followed.' },
    { section: 'status', path: '/status/gone', name: 'Gone page', respond: errorPage(410, 'Gone page'), filters: ERROR, fields: { status: 410 } },
    { section: 'status', path: '/status/server-error', name: 'Server error', respond: errorPage(500, 'Server error'), filters: ERROR, fields: { status: 500 } },
    {
        section: 'status',
        path: '/status/unavailable',
        name: 'Unavailable page',
        respond: page({ name: 'Unavailable page', status: 503, headers: { 'retry-after': '120' }, description: null, canonical: null, text: '<p>Down for maintenance.</p>' }),
        filters: ERROR,
        fields: { status: 503, error: null },
        note: 'A plain 503 is not bot protection.',
    },
    {
        section: 'status',
        path: '/status/dropped',
        name: 'Dropped connection',
        respond: (req) => {
            req.socket.destroy();
        },
        filters: ERROR,
        fields: { status: null },
    },
    { section: 'status', path: '/status/slow', name: 'Slow page', respond: page({ name: 'Slow page', delayMs: 1500 }), filters: ['slow'] },

    // --- Redirects ------------------------------------------------------------------------------------------
    { section: 'redirects', path: '/redirects/target-a', name: 'Redirect target A', respond: page({ name: 'Redirect target A' }) },
    { section: 'redirects', path: '/redirects/target-b', name: 'Redirect target B', respond: page({ name: 'Redirect target B' }) },
    ...[301, 302, 307, 308].map(
        (status): Case => ({
            section: 'redirects',
            path: `/redirects/${status}`,
            name: `${status} redirect`,
            respond: redirect(status, '/redirects/target-a'),
            filters: REDIRECT,
            fields: { status, redirectType: 'HTTP Redirect', redirectUrl: /\/redirects\/target-a$/ },
        }),
    ),
    {
        section: 'redirects',
        path: '/redirects/chain-1',
        name: 'Redirect chain start',
        respond: redirect(301, '/redirects/chain-2'),
        filters: [...REDIRECT, 'redirect-chain'],
    },
    { section: 'redirects', path: '/redirects/chain-2', name: 'Redirect chain hop', respond: redirect(301, '/redirects/target-a'), listed: 'none', filters: REDIRECT },
    { section: 'redirects', path: '/redirects/loop-a', name: 'Redirect loop A', respond: redirect(302, '/redirects/loop-b'), filters: [...REDIRECT, 'redirect-loop'] },
    { section: 'redirects', path: '/redirects/loop-b', name: 'Redirect loop B', respond: redirect(302, '/redirects/loop-a'), listed: 'none', filters: [...REDIRECT, 'redirect-loop'] },
    { section: 'redirects', path: '/redirects/to-error', name: 'Redirect to a 404', respond: redirect(301, '/redirects/removed'), filters: [...REDIRECT, 'redirect-broken'] },
    { section: 'redirects', path: '/redirects/removed', name: 'Removed page', respond: errorPage(404, 'Removed page'), listed: 'none', filters: ERROR },
    {
        section: 'redirects',
        path: '/redirects/meta-refresh',
        name: 'Meta refresh redirect',
        respond: page({ name: 'Meta refresh redirect', head: '<meta http-equiv="refresh" content="0; url=/redirects/target-b">', canonical: null, description: null, text: BODY_REDIRECT_TEXT }),
        filters: REDIRECT,
        fields: { redirectType: 'Meta Refresh Redirect' },
        note: 'A refresh redirect is a redirect: content checks should not apply.',
    },
    {
        section: 'redirects',
        path: '/redirects/refresh-header',
        name: 'Refresh header redirect',
        respond: page({ name: 'Refresh header redirect', headers: { refresh: '0; url=/redirects/target-b' }, canonical: null, description: null, text: BODY_REDIRECT_TEXT }),
        filters: REDIRECT,
        fields: { redirectType: 'HTTP Refresh Redirect' },
    },
    {
        section: 'redirects',
        path: '/redirects/javascript',
        name: 'JavaScript redirect',
        // A full page, so fast mode (which can't see the redirect) finds nothing wrong.
        respond: page({ name: 'JavaScript redirect', body: `<script>location.replace('/redirects/target-b')</script>` }),
        fast: { filters: [] },
        js: { filters: REDIRECT, fields: { redirectType: 'JavaScript Redirect' } },
    },

    // --- Indexability ---------------------------------------------------------------------------------------
    { section: 'indexability', path: '/indexability/meta-noindex', name: 'Meta noindex', respond: page({ name: 'Meta noindex', head: '<meta name="robots" content="noindex, follow">' }), filters: ['noindex'] },
    { section: 'indexability', path: '/indexability/googlebot-noindex', name: 'Googlebot noindex', respond: page({ name: 'Googlebot noindex', head: '<meta name="googlebot" content="noindex">' }), filters: ['noindex'] },
    { section: 'indexability', path: '/indexability/x-robots-tag', name: 'X-Robots-Tag noindex', respond: page({ name: 'X-Robots-Tag noindex', headers: { 'x-robots-tag': 'noindex' } }), filters: ['noindex'] },
    { section: 'indexability', path: '/indexability/canonical-target', name: 'Canonical target', respond: page({ name: 'Canonical target' }) },
    {
        section: 'indexability',
        path: '/indexability/canonicalised',
        name: 'Canonicalised page',
        respond: page({ name: 'Canonicalised page', canonical: '/indexability/canonical-target' }),
        filters: ['noindex', 'canonicalised'],
    },
    {
        section: 'indexability',
        path: '/indexability/canonical-to-404',
        name: 'Canonical to a 404',
        respond: page({ name: 'Canonical to a 404', canonical: '/indexability/canonical-gone' }),
        filters: ['noindex', 'canonicalised', 'canonical-broken'],
    },
    { section: 'indexability', path: '/indexability/canonical-gone', name: 'Missing canonical target', respond: errorPage(404, 'Missing canonical target'), filters: ERROR },
    { section: 'indexability', path: '/indexability/no-canonical', name: 'No canonical', respond: page({ name: 'No canonical', canonical: null }), filters: ['canonical-missing'] },
    {
        section: 'indexability',
        path: '/indexability/relative-canonical',
        name: 'Relative canonical',
        respond: page({ name: 'Relative canonical', canonical: '/indexability/relative-canonical' }),
        note: 'A relative self canonical resolves to the page itself.',
    },
    {
        section: 'indexability',
        path: '/indexability/header-canonical',
        name: 'Canonical in header',
        respond: async (req, res, origin) => page({ name: 'Canonical in header', canonical: null, headers: { link: `<${origin}/indexability/header-canonical>; rel="canonical"` } })(req, res, origin),
    },
    {
        section: 'indexability',
        path: '/indexability/canonical-in-body',
        name: 'Canonical in body',
        // A <div> ends <head>, so the canonical after it is in <body> and ignored.
        respond: async (req, res, origin) => page({ name: 'Canonical in body', canonical: null, head: `<div></div><link rel="canonical" href="${origin}/indexability/canonical-in-body">` })(req, res, origin),
        filters: ['canonical-missing'],
    },
    {
        section: 'indexability',
        path: '/private/secret',
        name: 'Blocked by robots.txt',
        respond: page({ name: 'Blocked by robots.txt' }),
        filters: ['noindex'],
        fields: { status: null, statusText: 'Blocked by robots.txt', indexabilityReason: 'Blocked by robots.txt', error: null },
        note: 'Listed as non-indexable but never requested.',
    },

    // --- Titles ---------------------------------------------------------------------------------------------
    { section: 'titles', path: '/titles/missing', name: 'Title missing', respond: page({ name: 'Title missing', title: null }), filters: ['title-missing'] },
    { section: 'titles', path: '/titles/empty', name: 'Title empty', respond: page({ name: 'Title empty', title: '' }), filters: ['title-missing'] },
    { section: 'titles', path: '/titles/short', name: 'Title short', respond: page({ name: 'Title short', title: 'Short title' }), filters: ['title-short'] },
    {
        section: 'titles',
        path: '/titles/long',
        name: 'Title long',
        respond: page({ name: 'Title long', title: 'A very long page title that keeps going well past the sixty character limit' }),
        filters: ['title-long', 'title-wide'],
    },
    {
        section: 'titles',
        path: '/titles/long-narrow',
        name: 'Title long but narrow',
        // 64 characters of narrow letters: too long, but fits in 561 px.
        respond: page({ name: 'Title long but narrow', title: 'il il il il il il il il il il il il il il il il il il il il il il' }),
        filters: ['title-long'],
    },
    { section: 'titles', path: '/titles/wide', name: 'Title wide', respond: page({ name: 'Title wide', title: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' }), filters: ['title-wide'] },
    { section: 'titles', path: '/titles/duplicate-1', name: 'Duplicate title one', respond: page({ name: 'Duplicate title one', title: `Shared title | ${SITE_NAME}` }), filters: ['dup-title'] },
    { section: 'titles', path: '/titles/duplicate-2', name: 'Duplicate title two', respond: page({ name: 'Duplicate title two', title: `Shared title | ${SITE_NAME}` }), filters: ['dup-title'] },

    // --- Meta descriptions ----------------------------------------------------------------------------------
    { section: 'descriptions', path: '/descriptions/missing', name: 'Description missing', respond: page({ name: 'Description missing', description: null }), filters: ['desc-missing'] },
    { section: 'descriptions', path: '/descriptions/short', name: 'Description short', respond: page({ name: 'Description short', description: 'Too short.' }), filters: ['desc-short'] },
    {
        section: 'descriptions',
        path: '/descriptions/long',
        name: 'Description long',
        respond: page({
            name: 'Description long',
            description:
                'This meta description goes on for far too long, well beyond the length that search results show, so the end of it will be cut off with an ellipsis by the search engine.',
        }),
        filters: ['desc-long', 'desc-wide'],
    },
    {
        section: 'descriptions',
        path: '/descriptions/wide',
        name: 'Description wide',
        respond: page({ name: 'Description wide', description: 'W'.repeat(100) }),
        filters: ['desc-wide'],
    },
    { section: 'descriptions', path: '/descriptions/duplicate-1', name: 'Duplicate description one', respond: page({ name: 'Duplicate description one', description: defaultDescription('duplicate descriptions') }), filters: ['dup-desc'] },
    { section: 'descriptions', path: '/descriptions/duplicate-2', name: 'Duplicate description two', respond: page({ name: 'Duplicate description two', description: defaultDescription('duplicate descriptions') }), filters: ['dup-desc'] },

    // --- Headings -------------------------------------------------------------------------------------------
    { section: 'headings', path: '/headings/no-h1', name: 'No H1', respond: page({ name: 'No H1', h1: null }), filters: ['h1-missing'] },
    { section: 'headings', path: '/headings/empty-h1', name: 'Empty H1', respond: page({ name: 'Empty H1', h1: '' }), filters: ['h1-missing'], note: 'An empty <h1> is as good as none.' },
    { section: 'headings', path: '/headings/multiple-h1', name: 'Multiple H1', respond: page({ name: 'Multiple H1', h1: ['Multiple H1', 'Another H1'] }), filters: ['h1-multiple'], fields: { h1Count: 2 } },
    { section: 'headings', path: '/headings/duplicate-1', name: 'Duplicate H1 one', respond: page({ name: 'Duplicate H1 one', h1: 'Shared heading' }), filters: ['dup-h1'] },
    { section: 'headings', path: '/headings/duplicate-2', name: 'Duplicate H1 two', respond: page({ name: 'Duplicate H1 two', h1: 'Shared heading' }), filters: ['dup-h1'] },

    // --- Content --------------------------------------------------------------------------------------------
    { section: 'content', path: '/content/thin', name: 'Thin content', respond: page({ name: 'Thin content', words: 60 }), filters: ['thin'] },
    {
        section: 'content',
        path: '/content/exact-duplicate-1',
        name: 'Exact duplicate one',
        respond: page(EXACT_DUP),
        filters: ['dup-hash', 'dup-title', 'dup-desc', 'dup-h1', 'near-duplicates', 'canonical-missing'],
    },
    {
        section: 'content',
        path: '/content/exact-duplicate-2',
        name: 'Exact duplicate two',
        respond: page(EXACT_DUP),
        filters: ['dup-hash', 'dup-title', 'dup-desc', 'dup-h1', 'near-duplicates', 'canonical-missing'],
    },
    { section: 'content', path: '/content/near-duplicate-1', name: 'Near duplicate one', respond: page({ name: 'Near duplicate one', text: NEAR_DUP_TEXT }), filters: ['near-duplicates'] },
    { section: 'content', path: '/content/near-duplicate-2', name: 'Near duplicate two', respond: page({ name: 'Near duplicate two', text: NEAR_DUP_TEXT_2 }), filters: ['near-duplicates'] },
    {
        section: 'content',
        path: '/content/near-duplicate-noindex',
        name: 'Noindex near duplicate',
        respond: page({ name: 'Noindex near duplicate', text: NEAR_DUP_TEXT, head: '<meta name="robots" content="noindex">' }),
        filters: ['noindex'],
        fields: { nearDuplicates: null },
        note: 'Non-indexable pages are left out of near-duplicate checks.',
    },
    { section: 'content', path: '/content/hard-to-read', name: 'Hard to read', respond: page({ name: 'Hard to read', text: `<p>${HARD_TEXT}</p>` }), filters: ['hard-to-read'] },
    { section: 'content', path: '/content/no-lang', name: 'Language missing', respond: page({ name: 'Language missing', lang: null }), filters: ['no-lang'] },
    { section: 'content', path: '/content/uncompressed', name: 'Uncompressed HTML', respond: page({ name: 'Uncompressed HTML', gzip: false }), filters: ['uncompressed'] },

    // --- Images and files -----------------------------------------------------------------------------------
    {
        section: 'images',
        path: '/images/missing-alt',
        name: 'Images missing alt',
        respond: page({ name: 'Images missing alt', body: '<img src="/files/photo.png"><img src="/files/photo.png" alt="">' }),
        filters: ['img-alt'],
        fields: { imagesMissingAlt: 2 },
    },
    { section: 'images', path: '/images/with-alt', name: 'Images with alt', respond: page({ name: 'Images with alt', body: '<img src="/files/photo.png" alt="A photo">' }), fields: { imagesMissingAlt: 0 } },
    { section: 'images', path: '/files/photo.png', name: 'Linked image', respond: file('image/png', () => PNG), fields: { contentType: 'image/png', status: 200 } },
    {
        section: 'images',
        path: '/files/report.pdf',
        name: 'Noindex PDF',
        respond: file('application/pdf', () => PDF, { 'x-robots-tag': 'noindex' }),
        filters: ['noindex'],
        fields: { contentType: 'application/pdf' },
    },

    // --- Internal links -------------------------------------------------------------------------------------
    {
        section: 'links',
        path: '/links/weak',
        name: 'Weakly linked page',
        respond: page({ name: 'Weakly linked page', body: `<p>${link('/links/chain-1', 'Start of the deep chain')}</p>` }),
        listed: 'section',
        filters: ['weak-inlinks'],
        fields: { uniqueInlinks: 1 },
    },
    ...[1, 2, 3, 4].map(
        (n): Case => ({
            section: 'links',
            path: `/links/chain-${n}`,
            name: `Deep chain page ${n}`,
            respond: page({ name: `Deep chain page ${n}`, body: n < 4 ? `<p>${link(`/links/chain-${n + 1}`, 'Next in the chain')}</p>` : '' }),
            listed: 'none',
            filters: ['weak-inlinks'],
            // / → /links/ → /links/weak → chain-1...
            fields: { depth: 2 + n },
        }),
    ),
    {
        section: 'links',
        path: '/links/js-links',
        name: 'Links added by JS',
        respond: page({
            name: 'Links added by JS',
            body: `<p id="js-links"></p><script>document.getElementById('js-links').innerHTML = '<a href="/links/js-target">JS target</a>';</script>`,
        }),
        js: { filters: ['js-outlinks'] },
    },
    {
        section: 'links',
        path: '/links/js-target',
        name: 'Only linked via JS',
        respond: page({ name: 'Only linked via JS' }),
        listed: 'none',
        fast: { crawled: false },
        js: { filters: ['js-only-inlinks', 'weak-inlinks'] },
    },
    {
        section: 'links',
        path: '/links/outbound',
        name: 'External links',
        respond: (req, res, origin) => {
            const other = origin.replace('127.0.0.1', 'localhost');
            return page({ name: 'External links', body: `<p>${link('https://example.org/', 'Example')} ${link(`${other}/status/ok`, 'Same server, other hostname')} ${link('mailto:a@example.org', 'Mail')}</p>` })(req, res, origin);
        },
        fields: { uniqueExternalLinks: 2 },
        note: 'Other hostnames (localhost vs 127.0.0.1, www vs bare) are out of scope.',
    },
    {
        section: 'links',
        path: '/links/fragments',
        name: 'Links with fragments',
        respond: page({ name: 'Links with fragments', body: `<p>${link('/status/ok#top', 'With fragment')} ${link('#section', 'Same page')}</p>` }),
        note: '/status/ok#top must not become a second row.',
    },

    // --- Performance ----------------------------------------------------------------------------------------
    {
        section: 'performance',
        path: '/performance/heavy',
        name: 'Heavy page',
        respond: page({ name: 'Heavy page', body: '<script src="/files/heavy.js"></script>' }),
        fast: { filters: [] },
        js: { filters: ['heavy'] },
        note: 'Only JS mode loads resources, so only it can see the page weight.',
    },
    { section: 'performance', path: '/files/heavy.js', name: 'Heavy script', respond: file('text/javascript', heavy), listed: 'none', crawled: false },

    // --- Bot protection -------------------------------------------------------------------------------------
    {
        section: 'bot',
        path: '/bot/cloudflare',
        name: 'Cloudflare challenge',
        respond: page({ name: 'Cloudflare challenge', status: 403, title: 'Just a moment...', headers: { server: 'cloudflare' }, text: '<p>Checking your browser.</p>' }),
        filters: ERROR,
        fields: { error: /Cloudflare/ },
    },
    {
        section: 'bot',
        path: '/bot/akamai',
        name: 'Akamai challenge',
        respond: page({ name: 'Akamai challenge', body: '<div id="sec-if-cpt-container"></div>' }),
        filters: ERROR,
        fields: { error: /Akamai/ },
    },

    // --- Edge cases -----------------------------------------------------------------------------------------
    {
        section: 'robust',
        path: '/robust/formula-title',
        name: 'Formula in title',
        respond: page({ name: 'Formula in title', title: '=HYPERLINK("http://example.org","Click me") page' }),
        note: 'The CSV export must prefix this title with a quote so spreadsheets do not run it.',
    },
    { section: 'robust', path: '/robust/caf%C3%A9', name: 'Accented URL', respond: page({ name: 'Accented URL', title: `Café menu | ${SITE_NAME}` }) },
    { section: 'robust', path: '/robust/plain.txt', name: 'Plain text file', respond: file('text/plain; charset=utf-8', () => Buffer.from('Just some text.\n')), fields: { contentType: /^text\/plain/ } },
];

// Every page that isn't a case: home, sitemap and the section indexes. All clean.
const listedIn = (where: 'section' | 'sitemap') => (c: Case) => (c.listed ?? 'both') === 'both' || (where === 'section' && c.listed === 'section');

const STRUCTURE: Case[] = [
    {
        section: 'status',
        path: '/',
        name: 'Home',
        respond: page({ name: 'Home', title: `Home | ${SITE_NAME}`, body: `<p>${link('/sitemap', 'Every test page')}</p>` }),
        fields: { depth: 0 },
    },
    {
        section: 'status',
        path: '/sitemap',
        name: 'Sitemap',
        respond: page({ name: 'Sitemap', body: `<ul>${CASES.filter(listedIn('sitemap')).map((c) => `<li>${link(c.path, c.name)}</li>`).join('')}</ul>` }),
    },
    ...(Object.entries(SECTIONS) as [SectionId, string][]).map(
        ([id, label]): Case => ({
            section: id,
            path: sectionPath(id),
            name: label,
            respond: page({
                name: label,
                body: `<ul>${CASES.filter((c) => c.section === id && listedIn('section')(c))
                    .map((c) => `<li>${link(c.path, c.name)}</li>`)
                    .join('')}</ul>`,
            }),
        }),
    ),
];

export const ALL_CASES: Case[] = [...STRUCTURE, ...CASES];

const ROBOTS = 'User-agent: *\nDisallow: /private/\n';

// ---------------------------------------------------------------------------------------------------------------
// Server

export interface TestSite {
    server: Server;
    origin: string;
    close: () => Promise<void>;
}

export async function startTestSite(port = 0, host = '127.0.0.1'): Promise<TestSite> {
    const routes = new Map(ALL_CASES.map((c) => [c.path, c.respond]));
    const server = createServer(async (req, res) => {
        const origin = `http://${req.headers.host ?? `${host}:${port}`}`;
        const path = new URL(req.url ?? '/', origin).pathname;
        try {
            if (path === '/robots.txt') return send(req, res, 200, { 'content-type': 'text/plain' }, ROBOTS, false);
            const respond = routes.get(path);
            if (respond) return await respond(req, res, origin);
            await errorPage(404, 'Page not found')(req, res, origin);
        } catch (err) {
            if (!res.headersSent) res.writeHead(500).end(String(err));
        }
    });
    await new Promise<void>((resolve) => server.listen(port, host, resolve));
    const actual = (server.address() as AddressInfo).port;
    return {
        server,
        origin: `http://${host}:${actual}`,
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(() => resolve());
            }),
    };
}
