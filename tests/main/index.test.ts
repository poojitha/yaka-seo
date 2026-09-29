import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { makeResult } from '../fixtures';

// --- Electron and SiteCrawler are replaced so the IPC layer can be tested on its own. ---

const electron = vi.hoisted(() => {
    const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
    const sent: { channel: string; payload: any }[] = [];
    return {
        handlers,
        sent,
        showSaveDialog: vi.fn(),
    };
});

vi.mock('electron', () => {
    class BrowserWindow {
        static getAllWindows = () => [];
        webContents = { send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }) };
        loadURL() {}
        loadFile() {}
        on() {}
    }
    return {
        app: { getPath: () => tmpdir(), whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
        BrowserWindow,
        dialog: { showSaveDialog: electron.showSaveDialog },
        ipcMain: { handle: (channel: string, fn: any) => electron.handlers.set(channel, fn) },
    };
});

const crawlerMock = vi.hoisted(() => ({
    isRunning: false,
    run: vi.fn<(options: CrawlOptions, onPage: (r: PageResult) => void) => Promise<void>>(),
    stop: vi.fn(),
    teardown: vi.fn(),
}));

vi.mock('../../src/main/crawler', () => ({
    SiteCrawler: class {
        get isRunning() {
            return crawlerMock.isRunning;
        }
        run = crawlerMock.run;
        stop = crawlerMock.stop;
        teardown = crawlerMock.teardown;
    },
}));

const invoke = (channel: string, ...args: unknown[]) => electron.handlers.get(channel)!({}, ...args);
const progressEvents = () => electron.sent.filter((m) => m.channel === 'crawl:progress').map((m) => m.payload as CrawlProgress);
const resultBatches = () => electron.sent.filter((m) => m.channel === 'crawl:results').map((m) => m.payload as PageResult[]);
const options: CrawlOptions = { startUrl: 'https://example.com/', maxPages: 10, maxDepth: 2, concurrency: 2, renderJs: false, userAgent: '' };

beforeAll(async () => {
    await import('../../src/main/index');
    // createWindow() runs after app.whenReady() resolves.
    await vi.waitFor(() => expect(electron.handlers.size).toBeGreaterThan(0));
});

beforeEach(() => {
    vi.useFakeTimers();
    electron.sent.length = 0;
    crawlerMock.isRunning = false;
    crawlerMock.run.mockReset();
    crawlerMock.stop.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('main process IPC', () => {
    it('points Crawlee storage at userData, not the working directory', () => {
        expect(process.env.CRAWLEE_STORAGE_DIR).toBe(join(tmpdir(), 'crawlee-storage'));
    });

    it('crawl:start reports running, streams results in 250 ms batches, then reports finished', async () => {
        let onPage!: (r: PageResult) => void;
        let finish!: () => void;
        crawlerMock.run.mockImplementation((_opts, cb) => {
            onPage = cb;
            return new Promise<void>((r) => (finish = r));
        });

        await invoke('crawl:start', options);
        expect(crawlerMock.run).toHaveBeenCalledWith(options, expect.any(Function));
        expect(progressEvents()).toEqual([{ status: 'running', crawled: 0 }]);

        onPage(makeResult({ url: 'https://example.com/1' }));
        onPage(makeResult({ url: 'https://example.com/2' }));
        expect(resultBatches()).toHaveLength(0); // buffered, not sent per page

        await vi.advanceTimersByTimeAsync(250);
        expect(resultBatches()).toEqual([[expect.objectContaining({ url: 'https://example.com/1' }), expect.objectContaining({ url: 'https://example.com/2' })]]);
        expect(progressEvents().at(-1)).toEqual({ status: 'running', crawled: 2 });

        await vi.advanceTimersByTimeAsync(1000);
        expect(resultBatches()).toHaveLength(1); // nothing new, nothing sent

        onPage(makeResult({ url: 'https://example.com/3' }));
        finish();
        await vi.runOnlyPendingTimersAsync();

        // Last page is flushed immediately on completion, before 'finished'.
        expect(resultBatches().at(-1)).toEqual([expect.objectContaining({ url: 'https://example.com/3' })]);
        expect(progressEvents().at(-1)).toEqual({ status: 'finished', crawled: 3 });
        expect(vi.getTimerCount()).toBe(0); // flush interval cleared
    });

    it('crawl:start does not wait for the crawl to finish', async () => {
        crawlerMock.run.mockReturnValue(new Promise(() => {}));
        await expect(invoke('crawl:start', options)).resolves.toBeUndefined();
    });

    it('crawl:start reports an error with the crawled count and message when the crawl fails', async () => {
        let onPage!: (r: PageResult) => void;
        let fail!: (e: Error) => void;
        crawlerMock.run.mockImplementation((_opts, cb) => {
            onPage = cb;
            return new Promise<void>((_r, reject) => (fail = reject));
        });

        await invoke('crawl:start', options);
        onPage(makeResult());
        fail(new Error('Browser crashed'));
        await vi.runOnlyPendingTimersAsync();

        expect(resultBatches()).toHaveLength(1);
        expect(progressEvents().at(-1)).toEqual({ status: 'error', crawled: 1, message: 'Browser crashed' });
    });

    it('crawl:start is rejected while a crawl is running', async () => {
        crawlerMock.isRunning = true;
        await expect(invoke('crawl:start', options)).rejects.toThrow('A crawl is already running');
        expect(crawlerMock.run).not.toHaveBeenCalled();
    });

    it('crawl:stop asks the crawler to stop gracefully', async () => {
        await invoke('crawl:stop');
        expect(crawlerMock.stop).toHaveBeenCalledOnce();
    });

    describe('export:csv', () => {
        let dir: string;
        beforeEach(async () => {
            vi.useRealTimers();
            dir = await mkdtemp(join(tmpdir(), 'screamingai-csv-'));
        });
        afterEach(() => rm(dir, { recursive: true, force: true }));

        it('writes the rows as CSV to the chosen file and returns its path', async () => {
            const filePath = join(dir, 'out.csv');
            electron.showSaveDialog.mockResolvedValue({ canceled: false, filePath });

            const rows = [makeResult({ url: 'https://example.com/a', title: 'Hello, world' })];
            await expect(invoke('export:csv', rows)).resolves.toBe(filePath);

            const csv = await readFile(filePath, 'utf8');
            expect(csv.startsWith('﻿url,')).toBe(true);
            expect(csv).toContain('https://example.com/a');
            expect(csv).toContain('"Hello, world"');
            expect(electron.showSaveDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ defaultPath: 'crawl.csv' }));
        });

        it('returns null and writes nothing when the dialog is cancelled', async () => {
            electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
            await expect(invoke('export:csv', [makeResult()])).resolves.toBeNull();
        });
    });
});
