import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CrawlProgress, PageResult, ScreamingApi } from '@shared/types';
import { makeResult } from '../fixtures';
import { App } from '../../src/renderer/src/App';

let emitResults: (rows: PageResult[]) => void;
let emitProgress: (p: CrawlProgress) => void;
let api: { [K in keyof ScreamingApi]: ReturnType<typeof vi.fn> };

beforeEach(() => {
    api = {
        startCrawl: vi.fn().mockResolvedValue(undefined),
        stopCrawl: vi.fn().mockResolvedValue(undefined),
        exportCsv: vi.fn().mockResolvedValue('C:/out.csv'),
        onResults: vi.fn((cb) => {
            emitResults = cb;
            return () => {};
        }),
        onProgress: vi.fn((cb) => {
            emitProgress = cb;
            return () => {};
        }),
    };
    (window as unknown as { api: ScreamingApi }).api = api as unknown as ScreamingApi;
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** Fill in a URL, press Start, and simulate main reporting some pages. */
async function startCrawl(url = 'https://example.com/') {
    fireEvent.change(field('Website URL'), { target: { value: url } });
    await act(async () => click('Start'));
    act(() => emitProgress({ status: 'running', crawled: 0 }));
}

const pages = [
    makeResult({ url: 'https://example.com/', title: 'Home' }),
    makeResult({ url: 'https://example.com/missing', status: 404, indexable: false, indexabilityReason: 'Status 404' }),
    makeResult({ url: 'https://example.com/no-title', title: '', titleLength: 0 }),
];

describe('App', () => {
    it('opens on the start screen with default settings (Render JavaScript on)', () => {
        render(<App />);
        expect(screen.getByRole('heading', { name: 'Yaka|SEO' })).toBeTruthy();
        expect(field('Max pages').value).toBe('500');
        expect(field('Depth').value).toBe('10');
        expect(field('Threads').value).toBe('10');
        expect(field('Render JavaScript').checked).toBe(true);
        expect(screen.queryByText('Export CSV')).toBeNull();
    });

    it('Start sends the options to main and shows the crawling screen with the latest URL', async () => {
        render(<App />);
        await startCrawl();
        expect(api.startCrawl).toHaveBeenCalledWith({ startUrl: 'https://example.com/', maxPages: 500, maxDepth: 10, concurrency: 10, renderJs: true });
        expect(screen.getByRole('heading').textContent).toBe('Crawling…');

        act(() => emitResults(pages.slice(0, 2)));
        expect(screen.getByText('https://example.com/missing')).toBeTruthy();
        expect(screen.getByText('2 pages crawled (max 500)')).toBeTruthy();

        act(() => emitProgress({ status: 'finished', crawled: 2 }));
        expect(screen.getByRole('heading').textContent).toBe('Crawl complete');
    });

    it('Stop on the crawling screen asks main to stop', async () => {
        render(<App />);
        await startCrawl();
        await act(async () => click('Stop'));
        expect(api.stopCrawl).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Stopping…' })).toBeTruthy();
    });

    it('Continue shows the results table, with filters, counts and search', async () => {
        render(<App />);
        await startCrawl();
        act(() => {
            emitResults(pages);
            emitProgress({ status: 'finished', crawled: 3 });
        });
        click('Continue');

        const allTab = screen.getByRole('button', { name: /^All/ });
        expect(allTab.textContent).toBe('All 3');
        expect(screen.getByRole('button', { name: /4xx/ }).textContent).toContain('1');

        click('4xx / 5xx / Failed 1');
        expect(screen.queryByText('https://example.com/no-title')).toBeNull();
        expect(screen.getByText('https://example.com/missing', { selector: '.cell' })).toBeTruthy();

        fireEvent.click(allTab);
        fireEvent.change(screen.getByPlaceholderText('Search URL or title…'), { target: { value: 'home' } });
        expect(screen.getAllByText(/https:\/\/example\.com/, { selector: '.row:not(.header) .cell:first-child' })).toHaveLength(1);
    });

    it('selecting a row shows its details', async () => {
        render(<App />);
        await startCrawl();
        act(() => emitResults(pages));
        click('Continue');
        fireEvent.click(screen.getByText('Home', { selector: '.cell' }));
        expect(screen.getByText('indexabilityReason', { selector: 'dt' })).toBeTruthy();
    });

    it('Export CSV sends the visible rows to main', async () => {
        render(<App />);
        await startCrawl();
        act(() => {
            emitResults(pages);
            emitProgress({ status: 'finished', crawled: 3 });
        });
        click('Continue');
        click('4xx / 5xx / Failed 1');
        await act(async () => click('Export CSV'));
        expect(api.exportCsv).toHaveBeenCalledWith([pages[1]]);
    });

    it('the results toolbar shows Stop while running and New crawl when done', async () => {
        render(<App />);
        await startCrawl();
        click('Continue');
        expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'New crawl' })).toBeNull();

        act(() => emitProgress({ status: 'finished', crawled: 0 }));
        expect(screen.getByRole('button', { name: 'New crawl' })).toBeTruthy();
    });

    it('New crawl reopens setup with the last settings, and a new crawl clears old results', async () => {
        render(<App />);
        fireEvent.change(field('Depth'), { target: { value: '3' } });
        await startCrawl('https://first.example/');
        act(() => {
            emitResults(pages);
            emitProgress({ status: 'finished', crawled: 3 });
        });
        click('Continue');
        click('New crawl');

        expect(field('Website URL').value).toBe('https://first.example/');
        expect(field('Depth').value).toBe('3');

        await startCrawl('https://second.example/');
        expect(screen.getByText('0 pages crawled (max 500)')).toBeTruthy();
    });

    it('closing the start screen returns to the previous results', async () => {
        render(<App />);
        await startCrawl();
        act(() => {
            emitResults(pages);
            emitProgress({ status: 'finished', crawled: 3 });
        });
        click('Continue');
        click('New crawl');
        click('Close');
        expect(screen.getByRole('button', { name: /^All/ }).textContent).toBe('All 3');
        expect(api.startCrawl).toHaveBeenCalledOnce();
    });

    it('shows a crawl error in the status bar', async () => {
        render(<App />);
        await startCrawl();
        click('Continue');
        act(() => emitProgress({ status: 'error', crawled: 0, message: 'Browser crashed' }));
        expect(screen.getByText('Browser crashed')).toBeTruthy();
        expect(screen.getByText('ERROR')).toBeTruthy();
    });
});
