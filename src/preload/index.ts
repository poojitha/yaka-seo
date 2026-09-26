import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { CrawlProgress, PageResult, ScreamingApi } from '@shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void) {
    const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const api: ScreamingApi = {
    startCrawl: (options) => ipcRenderer.invoke('crawl:start', options),
    stopCrawl: () => ipcRenderer.invoke('crawl:stop'),
    exportCsv: (rows) => ipcRenderer.invoke('export:csv', rows),
    onResults: (cb) => subscribe<PageResult[]>('crawl:results', cb),
    onProgress: (cb) => subscribe<CrawlProgress>('crawl:progress', cb),
};

contextBridge.exposeInMainWorld('api', api);
