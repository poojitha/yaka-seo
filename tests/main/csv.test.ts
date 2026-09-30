import { describe, expect, it } from 'vitest';
import { toCsv } from '../../src/main/csv';
import { makeResult } from '../fixtures';

const BOM = '﻿';

describe('toCsv', () => {
    it('returns an empty string for no rows', () => {
        expect(toCsv([])).toBe('');
    });

    it('starts with a UTF-8 BOM and uses PageResult keys as the header row', () => {
        const csv = toCsv([makeResult()]);
        expect(csv.startsWith(BOM)).toBe(true);
        const header = csv.slice(1).split('\r\n')[0];
        expect(header.split(',')).toEqual(Object.keys(makeResult()));
    });

    it('writes one CRLF-separated line per row', () => {
        const csv = toCsv([makeResult({ url: 'https://a.com/' }), makeResult({ url: 'https://b.com/' })]);
        const lines = csv.slice(1).split('\r\n');
        expect(lines).toHaveLength(3);
        expect(lines[1].startsWith('https://a.com/,')).toBe(true);
        expect(lines[2].startsWith('https://b.com/,')).toBe(true);
    });

    it('quotes values containing commas, quotes or newlines and doubles embedded quotes', () => {
        const csv = toCsv([makeResult({ title: 'Hello, "world"', metaDescription: 'line1\nline2', h1: 'plain' })]);
        expect(csv).toContain('"Hello, ""world"""');
        expect(csv).toContain('"line1\nline2"');
        expect(csv).toContain(',plain,');
    });

    it('writes null as empty and booleans/numbers as text', () => {
        const csv = toCsv([makeResult({ redirectUrl: null, status: null, indexable: false, wordCount: 42, error: null })]);
        const [header, row] = csv.slice(1).split('\r\n');
        const cells = Object.fromEntries(header.split(',').map((h, i) => [h, row.split(',')[i]]));
        expect(cells.redirectUrl).toBe('');
        expect(cells.status).toBe('');
        expect(cells.indexable).toBe('false');
        expect(cells.wordCount).toBe('42');
        expect(cells.error).toBe('');
    });

    it('neutralizes crawled text that a spreadsheet would run as a formula', () => {
        const csv = toCsv([
            makeResult({ title: '=HYPERLINK("https://evil.example","x")', metaDescription: '+1', h1: '-cmd', canonical: '@SUM(A1)', error: '\tTab' }),
        ]);
        expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""x"")"`);
        expect(csv).toContain(",'+1,");
        expect(csv).toContain(",'-cmd,");
        expect(csv).toContain(",'@SUM(A1),");
        expect(csv).toContain("'\tTab");
    });

    it('leaves numbers alone, including negative ones', () => {
        const [header, row] = toCsv([makeResult({ responseTimeMs: -1 })]).slice(1).split('\r\n');
        expect(row.split(',')[header.split(',').indexOf('responseTimeMs')]).toBe('-1');
    });

    it('keeps non-ASCII text intact', () => {
        expect(toCsv([makeResult({ title: 'Café – 日本語' })])).toContain('Café – 日本語');
    });
});
