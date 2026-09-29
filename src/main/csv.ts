import type { PageResult } from '@shared/types';

const escape = (value: unknown) => {
    let s = value === null || value === undefined ? '' : String(value);
    // Crawled text is untrusted: a title like `=HYPERLINK(...)` would run as a formula in Excel/Sheets.
    // Only strings are neutralized, so numbers such as -1 stay numeric.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: PageResult[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]) as (keyof PageResult)[];
    const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))];
    // BOM so Excel opens UTF-8 (non-ASCII titles) correctly.
    return '﻿' + lines.join('\r\n');
}
