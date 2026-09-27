import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeResult } from '../fixtures';
import { ResultsTable } from '../../src/renderer/src/ResultsTable';

const addresses = (container: HTMLElement) =>
    [...container.querySelectorAll('.row:not(.header)')]
        .sort((a, b) => parseInt((a as HTMLElement).style.top) - parseInt((b as HTMLElement).style.top))
        .map((row) => row.querySelector('.cell')!.textContent);

const rows = [
    makeResult({ url: 'https://example.com/b', wordCount: 300 }),
    makeResult({ url: 'https://example.com/c', wordCount: 100 }),
    makeResult({ url: 'https://example.com/a', wordCount: 200 }),
];

describe('ResultsTable', () => {
    it('renders a header and one row per result', () => {
        const { container } = render(<ResultsTable rows={rows} selected={null} onSelect={() => {}} />);
        expect(screen.getByText('Address')).toBeTruthy();
        expect(addresses(container)).toEqual(['https://example.com/b', 'https://example.com/c', 'https://example.com/a']);
    });

    it('clicking a header sorts ascending, then descending, then back to crawl order', () => {
        const { container } = render(<ResultsTable rows={rows} selected={null} onSelect={() => {}} />);
        const header = screen.getByText('Words');

        fireEvent.click(header);
        expect(header.textContent).toBe('Words ▲');
        expect(addresses(container)).toEqual(['https://example.com/c', 'https://example.com/a', 'https://example.com/b']);

        fireEvent.click(header);
        expect(header.textContent).toBe('Words ▼');
        expect(addresses(container)).toEqual(['https://example.com/b', 'https://example.com/a', 'https://example.com/c']);

        fireEvent.click(header);
        expect(header.textContent).toBe('Words');
        expect(addresses(container)).toEqual(['https://example.com/b', 'https://example.com/c', 'https://example.com/a']);
    });

    it('clicking a row selects it and highlights the selected row', () => {
        const onSelect = vi.fn();
        const { container, rerender } = render(<ResultsTable rows={rows} selected={null} onSelect={onSelect} />);
        fireEvent.click(screen.getByText('https://example.com/c'));
        expect(onSelect).toHaveBeenCalledWith(rows[1]);

        rerender(<ResultsTable rows={rows} selected={rows[1]} onSelect={onSelect} />);
        expect(container.querySelector('.row.selected')?.textContent).toContain('https://example.com/c');
    });

    it('shows ERR for failed rows, the indexability reason, and marks errors as bad', () => {
        const bad = [
            makeResult({ url: 'https://example.com/404', status: 404, indexable: false, indexabilityReason: 'Status 404' }),
            makeResult({ url: 'https://example.com/fail', status: null, error: 'ECONNRESET', indexable: false, indexabilityReason: 'Error' }),
        ];
        const { container } = render(<ResultsTable rows={bad} selected={null} onSelect={() => {}} />);
        expect(screen.getByText('ERR')).toBeTruthy();
        expect(screen.getByText('Status 404')).toBeTruthy();
        expect(container.querySelectorAll('.row.bad')).toHaveLength(2);
    });

    it('only renders the rows near the viewport for large crawls', () => {
        const many = Array.from({ length: 5000 }, (_, i) => makeResult({ url: `https://example.com/${i}` }));
        const { container } = render(<ResultsTable rows={many} selected={null} onSelect={() => {}} />);
        const rendered = container.querySelectorAll('.row:not(.header)').length;
        expect(rendered).toBeGreaterThan(0);
        expect(rendered).toBeLessThan(100);
    });
});
