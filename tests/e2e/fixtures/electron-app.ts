/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

type TestFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<TestFixtures>({
  electronApp: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-e2e-'));

    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../../dist-electron/main.js')],
      env: {
        ...process.env,
        ELECTRON_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'test',
      },
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
