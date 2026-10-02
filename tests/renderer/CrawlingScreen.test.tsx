import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CrawlProgress } from '@shared/types';
import { CrawlingScreen } from '../../src/renderer/src/CrawlingScreen';

const setup = (progress: CrawlProgress, { currentUrl = '', crawled = 0, maxPages = 100 } = {}) => {
    const onStop = vi.fn();
    const onContinue = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
        <CrawlingScreen
            startUrl="https://example.com/"
            maxPages={maxPages}
            progress={progress}
            currentUrl={currentUrl}
            crawled={crawled}
            onStop={onStop}
            onContinue={onContinue}
            onClose={onClose}
        />,
    );
    const bar = container.querySelector<HTMLElement>('.progress-bar > div')!;
    return { onStop, onContinue, onClose, container, bar };
};

describe('CrawlingScreen', () => {
    it('shows a spinner and "Connecting…" before the first page arrives', () => {
        const { container } = setup({ status: 'idle', crawled: 0 });
        expect(screen.getByRole('heading').textContent).toBe('Crawling…');
        expect(container.querySelector('.loader-ring')).toBeTruthy();
        expect(screen.getByText('Connecting…')).toBeTruthy();
        expect(screen.getByText('https://example.com/')).toBeTruthy();
    });

    it('shows the most recently crawled URL, page count and progress while running', () => {
        const { bar } = setup({ status: 'running', crawled: 25 }, { currentUrl: 'https://example.com/blog', crawled: 25, maxPages: 100 });
        expect(screen.getByText('https://example.com/blog')).toBeTruthy();
        expect(screen.getByText('25 pages crawled (max 100)')).toBeTruthy();
        expect(bar.style.width).toBe('25%');
    });

    it('uses the singular for one page and caps the bar at 100%', () => {
        setup({ status: 'running', crawled: 1 }, { crawled: 1 });
        expect(screen.getByText('1 page crawled (max 100)')).toBeTruthy();

        const { bar } = setup({ status: 'running', crawled: 150 }, { crawled: 150, maxPages: 100 });
        expect(bar.style.width).toBe('100%');
    });

    it('Stop and Show live results call their handlers while running, with a background hint', () => {
        const { onStop, onContinue } = setup({ status: 'running', crawled: 3 }, { crawled: 3 });
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        fireEvent.click(screen.getByRole('button', { name: 'Show live results' }));
        expect(screen.getByText(/keeps running in the background/)).toBeTruthy();
        expect(onStop).toHaveBeenCalledOnce();
        expect(onContinue).toHaveBeenCalledOnce();
    });

    it('disables Stop while stopping', () => {
        setup({ status: 'stopping', crawled: 3 }, { crawled: 3 });
        expect(screen.getByRole('heading').textContent).toBe('Stopping…');
        expect((screen.getByRole('button', { name: 'Stopping…' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows a check mark, full bar and only View results when finished', () => {
        const { container, bar } = setup({ status: 'finished', crawled: 40 }, { crawled: 40, maxPages: 500, currentUrl: 'https://example.com/last' });
        expect(screen.getByRole('heading').textContent).toBe('Crawl complete');
        expect(container.querySelector('.loader.ok')?.textContent).toBe('✓');
        expect(container.querySelector('.loader-ring')).toBeNull();
        expect(bar.style.width).toBe('100%');
        expect(screen.getByText('40 pages crawled')).toBeTruthy();
        expect(screen.queryByText('https://example.com/last')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
        expect(screen.getByRole('button', { name: 'View results' })).toBeTruthy();
        expect(screen.queryByText(/keeps running in the background/)).toBeNull();
    });

    it('shows "Crawl stopped" and View results after a stop', () => {
        const { container } = setup({ status: 'stopped', crawled: 7 }, { crawled: 7 });
        expect(screen.getByRole('heading').textContent).toBe('Crawl stopped');
        expect(container.querySelector('.loader.ok')?.textContent).toBe('✓');
        expect(screen.getByText('7 pages crawled')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'View results' })).toBeTruthy();
    });

    it('shows the error message when the crawl fails', () => {
        const { container } = setup({ status: 'error', crawled: 2, message: 'Browser crashed' }, { crawled: 2 });
        expect(screen.getByRole('heading').textContent).toBe('Crawl failed');
        expect(container.querySelector('.loader.fail')).toBeTruthy();
        expect(screen.getByText('Browser crashed')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    });

    it('the close button calls onClose, and is there while running and when done', () => {
        const { onClose, onStop } = setup({ status: 'running', crawled: 3 }, { crawled: 3 });
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledOnce();
        expect(onStop).not.toHaveBeenCalled();
    });
});
