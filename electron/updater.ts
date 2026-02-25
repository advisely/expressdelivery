import { autoUpdater } from 'electron-updater';
import { logDebug } from './logger.js';

type UpdateCallback = (event: string, data?: unknown) => void;

let callback: UpdateCallback | null = null;

export function setUpdateCallback(cb: UpdateCallback) {
  callback = cb;
}

export function initAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    logDebug('[UPDATER] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    logDebug(`[UPDATER] Update available: ${info.version}`);
    callback?.('update:available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', () => {
    logDebug('[UPDATER] No updates available.');
  });

  autoUpdater.on('download-progress', (progress) => {
    logDebug(`[UPDATER] Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    logDebug(`[UPDATER] Update downloaded: ${info.version}`);
    callback?.('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    logDebug(`[UPDATER] Error: ${err.message}`);
  });
}

export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}

export function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

export function installUpdate() {
  autoUpdater.quitAndInstall();
}
