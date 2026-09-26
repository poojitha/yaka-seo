import type { ScreamingApi } from '../shared/types';

declare global {
    interface Window {
        api: ScreamingApi;
    }
}
