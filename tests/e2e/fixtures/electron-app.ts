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
  /**
   * When set, main.ts inserts a synthetic oauth account with this auth_state
   * after initDatabase() runs. Test isolation is guaranteed by the fresh
   * ELECTRON_USER_DATA_DIR per test run. Only 'reauth_required' and
   * 'recommended_reauth' are meaningful — any other value is a no-op.
   */
  seedReauthAccount: string | undefined;
};

export const test = base.extend<TestFixtures>({
  seedReauthAccount: [undefined, { option: true }],

  electronApp: async ({ seedReauthAccount }, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-e2e-'));

    const appArgs = [path.join(__dirname, '../../../dist-electron/main.js')];
    // CI Linux runners need --no-sandbox for Chromium to launch
    if (process.env.CI) {
      appArgs.unshift('--no-sandbox', '--disable-gpu');
    }

    const launchEnv: Record<string, string | undefined> = {
      ...process.env,
      ELECTRON_USER_DATA_DIR: userDataDir,
      NODE_ENV: 'test',
    };
    if (seedReauthAccount) {
      launchEnv.EXPRESSDELIVERY_TEST_SEED_REAUTH = seedReauthAccount;
    }

    const electronApp = await electron.launch({
      args: appArgs,
      env: launchEnv,
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
