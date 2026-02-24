import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let debugLogPath: string | null = null;

function getLogPath(): string {
    if (!debugLogPath) {
        try {
            debugLogPath = path.join(app.getPath('logs'), 'debug_startup.log');
        } catch {
            debugLogPath = path.join(path.dirname(app.getPath('exe')), 'debug_startup.log');
        }
    }
    return debugLogPath;
}

export function logDebug(message: string): void {
    try {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(getLogPath(), `[${timestamp}] ${message}\n`);
    } catch {
        // Ignore if we can't write to log directory
    }
}
