import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type CrawlAnalysis, type CrawlProgress, type PageResult, type ScreamingApi } from '@shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void) {
    const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

const api: ScreamingApi = {
    startCrawl: (options) => ipcRenderer.invoke(IPC.startCrawl, options),
    stopCrawl: () => ipcRenderer.invoke(IPC.stopCrawl),
    exportCsv: (rows) => ipcRenderer.invoke(IPC.exportCsv, rows),
    onResults: (cb) => subscribe<PageResult[]>(IPC.results, cb),
    onProgress: (cb) => subscribe<CrawlProgress>(IPC.progress, cb),
    onAnalysis: (cb) => subscribe<CrawlAnalysis>(IPC.analysis, cb),
};

contextBridge.exposeInMainWorld('api', api);
