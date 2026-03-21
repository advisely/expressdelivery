/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type TestFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<TestFixtures>({
  electronApp: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-e2e-'));

    const appArgs = [path.join(__dirname, '../../../dist-electron/main.js')];
    // CI Linux runners need --no-sandbox for Chromium to launch
    if (process.env.CI) {
      appArgs.unshift('--no-sandbox', '--disable-gpu');
    }

    const electronApp = await electron.launch({
      args: appArgs,
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'test',
      },
    });

    // Capture process output for crash diagnostics
    electronApp.process().stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('debugger')) console.error('[Electron stderr]', msg);
    });
    electronApp.process().stdout?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && msg.includes('Error')) console.error('[Electron stdout]', msg);
    });

    await use(electronApp);

    await electronApp.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
