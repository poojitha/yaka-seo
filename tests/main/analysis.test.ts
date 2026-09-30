import { describe, expect, it } from 'vitest';
import { analyseCrawl, minhashSignature, signatureSimilarity, type CrawledPage } from '../../src/main/analysis';

const U = (path: string) => `https://example.com${path}`;
const page = (path: string, links: string[] = [], extra: Partial<CrawledPage> = {}): CrawledPage => ({
    url: U(path),
    isHtml200: true,
    links: links.map(U),
    jsLinks: new Set(),
    signature: null,
    ...extra,
});

/** `n` distinct sentences of ordinary words, so shingles are all different. */
const words = (n: number, seed = 0) =>
    Array.from({ length: n }, (_, i) => `word${(i * 7 + seed) % 1000} term${i} item${(i * 13 + seed) % 997}`).join(' ');

describe('analyseCrawl: inlinks', () => {
    it('counts every link, distinct linking pages, and ignores self-links and uncrawled targets', () => {
        const analysis = analyseCrawl([
            page('/', ['/a', '/a', '/b', '/', '/not-crawled']),
            page('/a', ['/b', '/a']),
            page('/b', []),
        ]);
        expect(analysis[U('/a')]).toMatchObject({ inlinks: 2, uniqueInlinks: 1 });
        expect(analysis[U('/b')]).toMatchObject({ inlinks: 2, uniqueInlinks: 2 });
        expect(analysis[U('/')]).toMatchObject({ inlinks: 0, uniqueInlinks: 0 });
    });

    it('counts pages whose link only exists after JavaScript as JS inlinks', () => {
        const analysis = analyseCrawl([page('/', ['/a', '/b'], { jsLinks: new Set([U('/b')]) }), page('/x', ['/b']), page('/a'), page('/b')]);
        expect(analysis[U('/a')].uniqueJsInlinks).toBe(0);
        expect(analysis[U('/b')]).toMatchObject({ uniqueInlinks: 2, uniqueJsInlinks: 1 });
    });

    it('% of Total is unique inlinks over the 200 HTML pages', () => {
        const analysis = analyseCrawl([
            page('/', ['/a']),
            page('/b', ['/a']),
            page('/c'),
            page('/a'),
            page('/missing', [], { isHtml200: false }),
            page('/file.pdf', [], { isHtml200: false }),
        ]);
        // 2 of 4 HTML 200 pages link to /a.
        expect(analysis[U('/a')].percentOfTotal).toBe(50);
        expect(analysis[U('/c')].percentOfTotal).toBe(0);
    });

    it('matches a crawled URL that had a #fragment', () => {
        const analysis = analyseCrawl([page('/', ['/a']), { ...page('/a'), url: U('/a#top') }]);
        expect(analysis[U('/a#top')].uniqueInlinks).toBe(1);
    });

    it('returns nothing for an empty crawl', () => {
        expect(analyseCrawl([])).toEqual({});
    });
});

describe('analyseCrawl: link score', () => {
    it('gives the best-linked page 100 and orders pages by how well they are linked', () => {
        // Every page links to /hub; only /hub links to /popular and /other; /popular is also linked by /other.
        const analysis = analyseCrawl([
            page('/hub', ['/popular', '/other']),
            page('/popular', ['/hub']),
            page('/other', ['/hub', '/popular']),
            page('/leaf', ['/hub']),
        ]);
        const score = (p: string) => analysis[U(p)].linkScore!;
        expect(Math.max(score('/hub'), score('/popular'), score('/other'), score('/leaf'))).toBe(100);
        expect(score('/hub')).toBe(100);
        expect(score('/popular')).toBeGreaterThan(score('/other'));
        expect(score('/other')).toBeGreaterThan(score('/leaf'));
        expect(score('/leaf')).toBeGreaterThan(0);
    });

    it('gives every page 100 when none links anywhere', () => {
        const analysis = analyseCrawl([page('/a'), page('/b')]);
        expect(analysis[U('/a')].linkScore).toBe(100);
        expect(analysis[U('/b')].linkScore).toBe(100);
    });
});

describe('analyseCrawl: near duplicates', () => {
    const text = words(300);
    // Same article with a few words changed near the end: ~98% of shingles shared.
    const nearCopy = text.replace('term290', 'changed').replace('term295', 'edited');

    it('finds near duplicates, the closest one and its similarity', () => {
        const analysis = analyseCrawl([
            page('/a', [], { signature: minhashSignature(text) }),
            page('/b', [], { signature: minhashSignature(nearCopy) }),
            page('/c', [], { signature: minhashSignature(words(300, 500)) }),
        ]);
        expect(analysis[U('/a')]).toMatchObject({ nearDuplicates: 1, closestNearDuplicate: U('/b') });
        expect(analysis[U('/a')].closestNearDuplicateSimilarity!).toBeGreaterThanOrEqual(90);
        expect(analysis[U('/b')]).toMatchObject({ nearDuplicates: 1, closestNearDuplicate: U('/a') });
        expect(analysis[U('/c')]).toMatchObject({ nearDuplicates: 0, closestNearDuplicate: '', closestNearDuplicateSimilarity: null });
    });

    it('reports exact copies as 100% similar and counts every duplicate', () => {
        const signature = minhashSignature(text);
        const analysis = analyseCrawl([page('/a', [], { signature }), page('/b', [], { signature }), page('/c', [], { signature })]);
        expect(analysis[U('/a')]).toMatchObject({ nearDuplicates: 2, closestNearDuplicateSimilarity: 100 });
    });

    it('does not check pages without a signature (non-indexable or too short)', () => {
        const analysis = analyseCrawl([page('/a', [], { signature: minhashSignature(text) }), page('/b')]);
        expect(analysis[U('/b')]).toMatchObject({ nearDuplicates: null, closestNearDuplicate: '' });
        expect(analysis[U('/a')].nearDuplicates).toBe(0);
    });
});

describe('minhashSignature', () => {
    it('needs at least 5 words, ignoring case and punctuation', () => {
        expect(minhashSignature('one two three four')).toBeNull();
        const a = minhashSignature('One, two; three four five!')!;
        expect(signatureSimilarity(a, minhashSignature('one two three four five')!)).toBe(1);
    });

    it('estimates text overlap: identical 1, unrelated about 0, half-shared in between', () => {
        const a = words(400);
        expect(signatureSimilarity(minhashSignature(a)!, minhashSignature(a)!)).toBe(1);
        expect(signatureSimilarity(minhashSignature(a)!, minhashSignature(words(400, 500))!)).toBeLessThan(0.1);
        // Second half replaced: about a third of the shingles are shared (Jaccard 200/600).
        const half = `${words(200)} ${words(200, 500).replace(/term/g, 'other')}`;
        const similarity = signatureSimilarity(minhashSignature(a)!, minhashSignature(half)!);
        expect(similarity).toBeGreaterThan(0.2);
        expect(similarity).toBeLessThan(0.5);
    });
});
