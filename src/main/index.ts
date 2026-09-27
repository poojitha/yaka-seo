import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { CrawlOptions, CrawlProgress, PageResult } from '@shared/types';
import { SiteCrawler } from './crawler';
import { toCsv } from './csv';
// electron-vite copies ?asset imports into out/ and resolves them to a file path at runtime.
import icon from '../../resources/icon.png?asset';

// Keep Crawlee from creating ./storage in whatever directory the app was launched from.
process.env.CRAWLEE_STORAGE_DIR = join(app.getPath('userData'), 'crawlee-storage');

const crawler = new SiteCrawler();
let mainWindow: BrowserWindow | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        title: 'Yaka|SEO',
        icon,
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
        },
    });

    if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    else mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

    mainWindow.on('closed', () => (mainWindow = null));
}

const send = (channel: string, payload: unknown) => mainWindow?.webContents.send(channel, payload);
const sendProgress = (progress: CrawlProgress) => send('crawl:progress', progress);

ipcMain.handle('crawl:start', async (_event, options: CrawlOptions) => {
    if (crawler.isRunning) throw new Error('A crawl is already running');

    // Batch results so a fast crawl doesn't flood the renderer with one IPC message per page.
    let buffer: PageResult[] = [];
    let crawled = 0;
    const flush = () => {
        if (buffer.length === 0) return;
        send('crawl:results', buffer);
        buffer = [];
        sendProgress({ status: 'running', crawled });
    };
    const timer = setInterval(flush, 250);

    sendProgress({ status: 'running', crawled: 0 });
    // Not awaited: the renderer gets results via events and shouldn't block on the whole crawl.
    crawler
        .run(options, (result) => {
            crawled++;
            buffer.push(result);
        })
        .then(() => {
            flush();
            sendProgress({ status: 'finished', crawled });
        })
        .catch((err: Error) => {
            flush();
            sendProgress({ status: 'error', crawled, message: err.message });
        })
        .finally(() => clearInterval(timer));
});

ipcMain.handle('crawl:stop', () => crawler.stop());

ipcMain.handle('export:csv', async (_event, rows: PageResult[]) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: 'crawl.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return null;
    await writeFile(filePath, toCsv(rows), 'utf8');
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
