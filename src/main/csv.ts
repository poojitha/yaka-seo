import type { PageResult } from '@shared/types';

const escape = (value: unknown) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: PageResult[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]) as (keyof PageResult)[];
    const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))];
    // BOM so Excel opens UTF-8 (non-ASCII titles) correctly.
    return '﻿' + lines.join('\r\n');
}
