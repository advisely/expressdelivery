import { test, expect } from './fixtures/electron-app.js';
import type { ConsoleMessage } from 'playwright';

/**
 * Console Health Test — catches runtime errors, warnings, and deprecations
 * across all app sections. Runs in Playwright Electron (headless Chromium).
 *
 * What it catches:
 * - Electron deprecation warnings
 * - React warnings (missing keys, act(), invalid props)
 * - Unhandled promise rejections
 * - CSP violations
 * - Runtime errors on each screen/section
 */

// Messages that are known/expected and should be ignored
const IGNORED_PATTERNS = [
  // Electron DevTools noise
  'DevTools listening',
  'Debugger attached',
  // React 19 contentEditable warning (from TipTap)
  'contentEditable',
  // Electron GPU info-level messages
  'GPU process',
  'Passthrough is not supported',
  // Chromium info-level noise
  'third-party cookie',
  'SharedArrayBuffer',
];

function isIgnored(text: string): boolean {
  return IGNORED_PATTERNS.some((p) => text.includes(p));
}

type LogEntry = { type: string; text: string; location: string };

test.describe('Console Health', () => {
  test('app launches without console errors or deprecation warnings', async ({
    page,
  }) => {
    const errors: LogEntry[] = [];
    const warnings: LogEntry[] = [];
    const deprecations: LogEntry[] = [];

    // Collect all console messages
    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (isIgnored(text)) return;

      const entry: LogEntry = {
        type: msg.type(),
        text: text.slice(0, 500),
        location: msg.location()
          ? `${msg.location().url}:${msg.location().lineNumber}`
          : 'unknown',
      };

      if (msg.type() === 'error') {
        errors.push(entry);
      } else if (msg.type() === 'warning') {
        // Separate deprecation warnings from regular warnings
        if (
          text.includes('deprecated') ||
          text.includes('Deprecation') ||
          text.includes('DEPRECATED')
        ) {
          deprecations.push(entry);
        } else {
          warnings.push(entry);
        }
      }
    });

    // Collect uncaught page errors
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message.slice(0, 500));
    });

    // Wait for React to mount and settle
    await page.waitForSelector('#root', { timeout: 15000 });
    await page.waitForTimeout(2000); // Let async effects settle

    // Report findings
    const report = {
      errors: errors.length,
      warnings: warnings.length,
      deprecations: deprecations.length,
      pageErrors: pageErrors.length,
    };

    // Log for CI visibility
    if (errors.length > 0) {
      console.log('\n=== CONSOLE ERRORS ===');
      errors.forEach((e) => console.log(`  [${e.location}] ${e.text}`));
    }
    if (deprecations.length > 0) {
      console.log('\n=== DEPRECATION WARNINGS ===');
      deprecations.forEach((d) => console.log(`  [${d.location}] ${d.text}`));
    }
    if (warnings.length > 0) {
      console.log('\n=== WARNINGS ===');
      warnings.forEach((w) => console.log(`  [${w.location}] ${w.text}`));
    }
    if (pageErrors.length > 0) {
      console.log('\n=== UNCAUGHT PAGE ERRORS ===');
      pageErrors.forEach((e) => console.log(`  ${e}`));
    }

    // Hard fail on errors and uncaught exceptions
    expect(pageErrors, 'Uncaught page errors detected').toHaveLength(0);
    expect(errors, `Console errors detected: ${JSON.stringify(report)}`).toHaveLength(0);

    // Hard fail on deprecation warnings (catch them before they become breaking)
    expect(
      deprecations,
      'Deprecation warnings detected — fix before next Electron upgrade'
    ).toHaveLength(0);

    // Warnings are logged but don't fail the test (soft check)
    if (warnings.length > 0) {
      console.log(
        `\n⚠ ${warnings.length} console warning(s) detected — review above`
      );
    }
  });

  test('settings modal opens without errors', async ({ page }) => {
    const errors: LogEntry[] = [];

    page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      if (isIgnored(text)) return;
      if (msg.type() === 'error') {
        errors.push({
          type: 'error',
          text: text.slice(0, 500),
          location: msg.location()
            ? `${msg.location().url}:${msg.location().lineNumber}`
            : 'unknown',
        });
      }
    });

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message.slice(0, 500));
    });

    await page.waitForSelector('#root', { timeout: 15000 });

    // Try to open settings via keyboard shortcut (Ctrl+,) or click
    const settingsButton = page.locator('[aria-label*="ettings"], [title*="ettings"]').first();
    if (await settingsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsButton.click();
      await page.waitForTimeout(1500);
    }

    // Check each settings category tab if settings opened
    const categoryTabs = page.locator('[role="tab"]');
    const tabCount = await categoryTabs.count().catch(() => 0);
    for (let i = 0; i < Math.min(tabCount, 5); i++) {
      const tab = categoryTabs.nth(i);
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(500);
      }
    }

    if (errors.length > 0) {
      console.log('\n=== SETTINGS MODAL ERRORS ===');
      errors.forEach((e) => console.log(`  [${e.location}] ${e.text}`));
    }

    expect(pageErrors, 'Uncaught errors in settings').toHaveLength(0);
    expect(errors, 'Console errors in settings modal').toHaveLength(0);
  });
});
