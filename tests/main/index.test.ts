import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrawlAnalysis, CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { makeResult } from '../fixtures';

// --- Electron and SiteCrawler are replaced so the IPC layer can be tested on its own. ---

const electron = vi.hoisted(() => {
    const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
    const sent: { channel: string; payload: any }[] = [];
    return {
        handlers,
        sent,
        windows: [] as any[],
        showSaveDialog: vi.fn(),
    };
});

vi.mock('electron', () => {
    class BrowserWindow {
        static getAllWindows = () => [];
        options: unknown;
        webContents = {
            send: (channel: string, payload: unknown) => electron.sent.push({ channel, payload }),
            mainFrame: {},
            listeners: new Map<string, (...args: any[]) => unknown>(),
            on(name: string, fn: (...args: any[]) => unknown) {
                this.listeners.set(name, fn);
            },
            windowOpenHandler: null as null | (() => unknown),
            setWindowOpenHandler(fn: () => unknown) {
                this.windowOpenHandler = fn;
            },
        };
        constructor(options: unknown) {
            this.options = options;
            electron.windows.push(this);
        }
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
    run: vi.fn<(options: CrawlOptions, onPage: (r: PageResult) => void) => Promise<CrawlAnalysis>>(),
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

const win = () => electron.windows[0];
/** Calls a handler as if from our window's top frame, which is the only sender main accepts. */
const invoke = (channel: string, ...args: unknown[]) => {
    const sender = win().webContents;
    return electron.handlers.get(channel)!({ sender, senderFrame: sender.mainFrame }, ...args);
};
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
    electron.showSaveDialog.mockReset();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('main process IPC', () => {
    it('points Crawlee storage at userData, not the working directory', () => {
        expect(process.env.CRAWLEE_STORAGE_DIR).toBe(join(tmpdir(), 'crawlee-storage'));
    });

    it('crawl:start reports running, streams results in 250 ms batches, then sends the analysis and reports finished', async () => {
        let onPage!: (r: PageResult) => void;
        let finish!: (analysis: CrawlAnalysis) => void;
        crawlerMock.run.mockImplementation((_opts, cb) => {
            onPage = cb;
            return new Promise<CrawlAnalysis>((r) => (finish = r));
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
        const { inlinks, uniqueInlinks, uniqueJsInlinks, percentOfTotal, linkScore, closestNearDuplicate, closestNearDuplicateSimilarity, nearDuplicates } =
            makeResult();
        const analysis: CrawlAnalysis = {
            'https://example.com/1': { inlinks, uniqueInlinks, uniqueJsInlinks, percentOfTotal, linkScore, closestNearDuplicate, closestNearDuplicateSimilarity, nearDuplicates },
        };
        finish(analysis);
        await vi.runOnlyPendingTimersAsync();

        // Last page is flushed immediately on completion, then the analysis, then 'finished'.
        expect(resultBatches().at(-1)).toEqual([expect.objectContaining({ url: 'https://example.com/3' })]);
        expect(electron.sent.slice(-4).map((m) => m.channel)).toEqual(['crawl:results', 'crawl:progress', 'crawl:analysis', 'crawl:progress']);
        expect(electron.sent.find((m) => m.channel === 'crawl:analysis')!.payload).toEqual(analysis);
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
            return new Promise<CrawlAnalysis>((_r, reject) => (fail = reject));
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

    it('crawl:stop asks the crawler to stop gracefully, reports stopping, then stopped', async () => {
        let finish!: () => void;
        crawlerMock.run.mockImplementation(() => new Promise<CrawlAnalysis>((r) => (finish = () => r({}))));
        await invoke('crawl:start', options);

        await invoke('crawl:stop');
        await invoke('crawl:stop'); // a second click doesn't stop twice
        expect(crawlerMock.stop).toHaveBeenCalledOnce();
        expect(progressEvents().at(-1)).toEqual({ status: 'stopping', crawled: 0 });

        finish();
        await vi.runOnlyPendingTimersAsync();
        expect(progressEvents().at(-1)).toEqual({ status: 'stopped', crawled: 0 });
    });

    it('crawl:stop does nothing when no crawl is running', async () => {
        await invoke('crawl:stop');
        expect(crawlerMock.stop).not.toHaveBeenCalled();
        expect(progressEvents()).toEqual([]);
    });

    it('rejects calls that do not come from the app window', async () => {
        const handler = electron.handlers.get('crawl:start')!;
        const foreign = { mainFrame: {} };
        await expect(handler({ sender: foreign, senderFrame: foreign.mainFrame }, options)).rejects.toThrow('unexpected sender');
        // A subframe of our own window isn't trusted either.
        await expect(handler({ sender: win().webContents, senderFrame: {} }, options)).rejects.toThrow('unexpected sender');
        expect(crawlerMock.run).not.toHaveBeenCalled();
    });

    it('crawl:start validates options before crawling', async () => {
        await expect(invoke('crawl:start', { ...options, startUrl: 'file:///C:/Windows/win.ini' })).rejects.toThrow('http or https');
        await expect(invoke('crawl:start', { ...options, maxPages: Number.NaN })).rejects.toThrow('maxPages');
        await expect(invoke('crawl:start', { ...options, userAgent: 'Bot\r\nX-Evil: 1' })).rejects.toThrow('control characters');
        expect(crawlerMock.run).not.toHaveBeenCalled();
        expect(progressEvents()).toEqual([]);
    });

    it('the window is sandboxed and cannot open popups or navigate away', () => {
        expect(win().options.webPreferences).toMatchObject({ contextIsolation: true, sandbox: true });
        expect(win().webContents.windowOpenHandler()).toEqual({ action: 'deny' });
        const event = { preventDefault: vi.fn() };
        win().webContents.listeners.get('will-navigate')(event, 'https://evil.example/');
        expect(event.preventDefault).toHaveBeenCalled();
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

        it('rejects a payload that is not a list of rows', async () => {
            await expect(invoke('export:csv', 'not rows')).rejects.toThrow('list of rows');
            expect(electron.showSaveDialog).not.toHaveBeenCalled();
        });

        it('returns null and writes nothing when the dialog is cancelled', async () => {
            electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
            await expect(invoke('export:csv', [makeResult()])).resolves.toBeNull();
        });
    });
});
