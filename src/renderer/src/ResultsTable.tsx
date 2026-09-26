import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PageResult } from '@shared/types';

const ROW_HEIGHT = 28;
const OVERSCAN = 10;

type Column = { key: keyof PageResult; label: string; width: number; render?: (r: PageResult) => ReactNode };

const COLUMNS: Column[] = [
    { key: 'url', label: 'Address', width: 360 },
    { key: 'status', label: 'Status', width: 70, render: (r) => r.status ?? 'ERR' },
    { key: 'indexable', label: 'Indexable', width: 150, render: (r) => (r.indexable ? 'Indexable' : r.indexabilityReason) },
    { key: 'title', label: 'Title', width: 280 },
    { key: 'titleLength', label: 'Title len', width: 75 },
    { key: 'metaDescription', label: 'Meta description', width: 280 },
    { key: 'metaDescriptionLength', label: 'Desc len', width: 75 },
    { key: 'h1', label: 'H1', width: 200 },
    { key: 'h1Count', label: 'H1s', width: 50 },
    { key: 'wordCount', label: 'Words', width: 70 },
    { key: 'internalLinks', label: 'Int. links', width: 80 },
    { key: 'externalLinks', label: 'Ext. links', width: 80 },
    { key: 'depth', label: 'Depth', width: 60 },
    { key: 'responseTimeMs', label: 'Time (ms)', width: 80 },
    { key: 'canonical', label: 'Canonical', width: 280 },
];

const gridTemplate = COLUMNS.map((c) => `${c.width}px`).join(' ');

interface Props {
    rows: PageResult[];
    selected: PageResult | null;
    onSelect: (row: PageResult) => void;
}

/** Sortable table that only renders the rows in view, so large crawls stay responsive. */
export function ResultsTable({ rows, selected, onSelect }: Props) {
    const [sort, setSort] = useState<{ key: keyof PageResult; dir: 1 | -1 } | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(600);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = scrollRef.current!;
        const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const sorted = useMemo(() => {
        if (!sort) return rows;
        return [...rows].sort((a, b) => {
            const av = a[sort.key] ?? '';
            const bv = b[sort.key] ?? '';
            return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
    }, [rows, sort]);

    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(sorted.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);

    const toggleSort = (key: keyof PageResult) =>
        setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

    return (
        <div
            className="table"
            ref={scrollRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
            <div className="row header" style={{ gridTemplateColumns: gridTemplate }}>
                {COLUMNS.map((c) => (
                    <div key={c.key} className="cell" onClick={() => toggleSort(c.key)}>
                        {c.label}
                        {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </div>
                ))}
            </div>
            <div style={{ height: sorted.length * ROW_HEIGHT, position: 'relative' }}>
                {sorted.slice(start, end).map((r, i) => (
                    <div
                        key={r.url}
                        className={`row${r === selected ? ' selected' : ''}${(r.status ?? 0) >= 400 || r.error ? ' bad' : ''}`}
                        style={{ gridTemplateColumns: gridTemplate, position: 'absolute', top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
                        onClick={() => onSelect(r)}
                    >
                        {COLUMNS.map((c) => {
                            const value = c.render ? c.render(r) : r[c.key];
                            return (
                                <div key={c.key} className="cell" title={String(value ?? '')}>
                                    {String(value ?? '')}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
