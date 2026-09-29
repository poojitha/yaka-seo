import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC, type CrawlProgress, type PageResult } from '@shared/types';
import { SiteCrawler } from './crawler';
import { toCsv } from './csv';
import { parseCrawlOptions } from './validate';
// electron-vite copies ?asset imports into out/ and resolves them to a file path at runtime.
import icon from '../../resources/icon.png?asset';

// Keep Crawlee from creating ./storage in whatever directory the app was launched from.
process.env.CRAWLEE_STORAGE_DIR = join(app.getPath('userData'), 'crawlee-storage');

const crawler = new SiteCrawler();
let mainWindow: BrowserWindow | null = null;
/** State of the crawl in progress, shared by the start and stop handlers. */
let current: { crawled: number; stopping: boolean } | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Yaka|SEO',
        icon,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            sandbox: true,
        },
    });

    // The window only ever shows our own UI; crawled content never loads here, but a stray link shouldn't either.
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

    if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

    mainWindow.on('closed', () => (mainWindow = null));
}

/** Only our window's top frame may call main; returns that window. */
function checkSender(event: IpcMainInvokeEvent): BrowserWindow {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
        throw new Error('IPC call from an unexpected sender');
    }
    return mainWindow;
}

const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload);
const sendProgress = (progress: CrawlProgress) => send(IPC.progress, progress);

ipcMain.handle(IPC.startCrawl, async (event, input: unknown) => {
    checkSender(event);
    const options = parseCrawlOptions(input);
    if (crawler.isRunning) throw new Error('A crawl is already running');

    const state = { crawled: 0, stopping: false };
    current = state;
    const status = () => (state.stopping ? 'stopping' : 'running');

    // Batch results so a fast crawl doesn't flood the renderer with one IPC message per page.
    let buffer: PageResult[] = [];
    const flush = () => {
        if (buffer.length === 0) return;
        send(IPC.results, buffer);
        buffer = [];
        sendProgress({ status: status(), crawled: state.crawled });
    };
    const timer = setInterval(flush, 250);

    sendProgress({ status: 'running', crawled: 0 });
    // Not awaited: the renderer gets results via events and shouldn't block on the whole crawl.
    crawler
        .run(options, (result) => {
            state.crawled++;
            buffer.push(result);
        })
        .then(() => {
            flush();
            sendProgress({ status: state.stopping ? 'stopped' : 'finished', crawled: state.crawled });
        })
        .catch((err: Error) => {
            flush();
            sendProgress({ status: 'error', crawled: state.crawled, message: err.message });
        })
        .finally(() => {
            clearInterval(timer);
            if (current === state) current = null;
        });
});

ipcMain.handle(IPC.stopCrawl, (event) => {
    checkSender(event);
    if (!current || current.stopping) return;
    current.stopping = true;
    sendProgress({ status: 'stopping', crawled: current.crawled });
    crawler.stop();
});

ipcMain.handle(IPC.exportCsv, async (event, rows: unknown) => {
    const win = checkSender(event);
    if (!Array.isArray(rows)) throw new Error('Export expects a list of rows');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: 'crawl.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return null;
    await writeFile(filePath, toCsv(rows as PageResult[]), 'utf8');
    return filePath;
});

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', async () => {
    await crawler.teardown();
    if (process.platform !== 'darwin') app.quit();
});
