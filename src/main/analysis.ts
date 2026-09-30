import type { CrawlAnalysis } from '@shared/types';

/** What the crawler keeps about each page for the post-crawl analysis. Stays in main; never sent to the UI. */
export interface CrawledPage {
    url: string;
    /** 200 HTML page: the denominator of "% of Total". */
    isHtml200: boolean;
    /** Internal link targets, one per <a> (so repeats count), absolute and without #fragment. */
    links: string[];
    /** Internal targets that only appear after JavaScript runs (JS mode). */
    jsLinks: Set<string>;
    /** MinHash signature of the page text; null when the page isn't checked for near duplicates. */
    signature: Uint32Array | null;
}

const DAMPING = 0.85;
/** Pages whose MinHash similarity is at least this are near duplicates (Screaming Frog's default). */
export const NEAR_DUPLICATE_THRESHOLD = 0.9;

// MinHash: 128 hash functions over 5-word shingles, bucketed into 16 bands of 8 for locality-sensitive hashing.
// A pair at 90% similarity shares a band with probability 1 - (1 - 0.9^8)^16 > 99.99%; at 50%, about 6%.
const SHINGLE_WORDS = 5;
const NUM_HASHES = 128;
const BANDS = 16;
const ROWS = NUM_HASHES / BANDS;

/** Crawlee may enqueue a URL with a #fragment; links are recorded without one. */
const key = (url: string) => {
    try {
        const u = new URL(url);
        u.hash = '';
        return u.href;
    } catch {
        return url;
    }
};

/** Inlinks, link score and near duplicates for every crawled page, keyed by `PageResult.url`. */
export function analyseCrawl(pages: CrawledPage[]): CrawlAnalysis {
    const index = new Map<string, number>();
    pages.forEach((p, i) => index.set(key(p.url), i));
    const n = pages.length;

    const inlinks = new Array<number>(n).fill(0);
    const sources = pages.map(() => new Set<number>());
    const jsSources = pages.map(() => new Set<number>());
    pages.forEach((page, from) => {
        for (const link of page.links) {
            const to = index.get(link);
            // Links to pages that weren't crawled (depth, page limit, robots.txt) aren't part of the graph.
            if (to === undefined || to === from) continue;
            inlinks[to]++;
            sources[to].add(from);
            if (page.jsLinks.has(link)) jsSources[to].add(from);
        }
    });

    const scores = linkScores(sources, n);
    const duplicates = nearDuplicates(pages);
    const html200 = pages.filter((p) => p.isHtml200).length;

    const analysis: CrawlAnalysis = {};
    pages.forEach((page, i) => {
        const dup = duplicates.get(i);
        analysis[page.url] = {
            inlinks: inlinks[i],
            uniqueInlinks: sources[i].size,
            uniqueJsInlinks: jsSources[i].size,
            percentOfTotal: html200 ? round((sources[i].size / html200) * 100) : 0,
            linkScore: scores[i],
            closestNearDuplicate: dup?.closest === undefined ? '' : pages[dup.closest].url,
            closestNearDuplicateSimilarity: dup?.closest === undefined ? null : round(dup.similarity * 100),
            nearDuplicates: page.signature ? (dup?.count ?? 0) : null,
        };
    });
    return analysis;
}

/**
 * PageRank over the internal link graph (each linking page counted once per target), scaled 0-100 on a log scale
 * so the best-linked page is 100. Screaming Frog's Link Score works the same way, but its exact scaling isn't public.
 */
function linkScores(sources: Set<number>[], n: number): number[] {
    if (n === 0) return [];
    const outDegree = new Array<number>(n).fill(0);
    sources.forEach((from) => from.forEach((f) => outDegree[f]++));

    let rank = new Array<number>(n).fill(1 / n);
    for (let iteration = 0; iteration < 100; iteration++) {
        // Pages with no outlinks share their rank with every page, as if the visitor jumped anywhere.
        const dangling = rank.reduce((sum, r, i) => (outDegree[i] === 0 ? sum + r : sum), 0);
        const next = new Array<number>(n).fill((1 - DAMPING) / n + (DAMPING * dangling) / n);
        sources.forEach((from, to) => from.forEach((f) => (next[to] += (DAMPING * rank[f]) / outDegree[f])));
        const change = next.reduce((sum, r, i) => sum + Math.abs(r - rank[i]), 0);
        rank = next;
        if (change < 1e-10) break;
    }
    const max = Math.max(...rank);
    return rank.map((r) => Math.round(100 * Math.log10(1 + (9 * r) / max)));
}

/** For each checked page that has near duplicates: how many, and the most similar one. */
function nearDuplicates(pages: CrawledPage[]) {
    const buckets = new Map<string, number[]>();
    pages.forEach((page, i) => {
        if (!page.signature) return;
        for (let band = 0; band < BANDS; band++) {
            const bucket = `${band}:${page.signature.subarray(band * ROWS, (band + 1) * ROWS).join(',')}`;
            const members = buckets.get(bucket);
            if (members) members.push(i);
            else buckets.set(bucket, [i]);
        }
    });

    const result = new Map<number, { count: number; closest?: number; similarity: number }>();
    const record = (page: number, other: number, similarity: number) => {
        const entry = result.get(page) ?? { count: 0, similarity: 0 };
        entry.count++;
        if (similarity > entry.similarity) {
            entry.closest = other;
            entry.similarity = similarity;
        }
        result.set(page, entry);
    };
    const compared = new Set<string>();
    for (const members of buckets.values()) {
        for (let a = 0; a < members.length; a++) {
            for (let b = a + 1; b < members.length; b++) {
                const [i, j] = [members[a], members[b]];
                const pair = `${i},${j}`;
                if (compared.has(pair)) continue;
                compared.add(pair);
                const similarity = signatureSimilarity(pages[i].signature!, pages[j].signature!);
                if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;
                record(i, j, similarity);
                record(j, i, similarity);
            }
        }
    }
    return result;
}

// Fixed seeds so the same text always gets the same signature.
const SEEDS = (() => {
    let state = 0x9e3779b9;
    return Uint32Array.from({ length: NUM_HASHES }, () => {
        state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
        return state;
    });
})();

/** murmur3's 32-bit finaliser: a fast bijective mix, so each seed gives a different permutation of hash values. */
function mix(h: number): number {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** FNV-1a over the string's UTF-16 code units. */
function hashString(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
}

/** MinHash signature of the text's 5-word shingles, or null if it has fewer than 5 words. */
export function minhashSignature(text: string): Uint32Array | null {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length < SHINGLE_WORDS) return null;
    const shingles = new Set<number>();
    for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) shingles.add(hashString(words.slice(i, i + SHINGLE_WORDS).join(' ')));

    const signature = new Uint32Array(NUM_HASHES).fill(0xffffffff);
    for (const shingle of shingles) {
        for (let k = 0; k < NUM_HASHES; k++) {
            const h = mix(shingle ^ SEEDS[k]);
            if (h < signature[k]) signature[k] = h;
        }
    }
    return signature;
}

/** Estimated Jaccard similarity of the two pages' shingle sets (0-1). */
export function signatureSimilarity(a: Uint32Array, b: Uint32Array): number {
    let same = 0;
    for (let k = 0; k < NUM_HASHES; k++) if (a[k] === b[k]) same++;
    return same / NUM_HASHES;
}

const round = (x: number) => Math.round(x * 1000) / 1000;
