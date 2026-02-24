/** Safe IPC wrapper for renderer process */

function api() {
    if (typeof window !== 'undefined' && window.electronAPI) {
        return window.electronAPI;
    }
    return null;
}

export async function ipcInvoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T | null> {
    const electron = api();
    if (!electron) {
        console.warn(`[IPC] Not in Electron context, channel: ${channel}`);
        return null;
    }
    return electron.invoke(channel, ...args) as Promise<T>;
}

export function ipcOn(channel: string, callback: (...args: unknown[]) => void): (() => void) | null {
    const electron = api();
    if (!electron) return null;
    return electron.on(channel, callback);
}
