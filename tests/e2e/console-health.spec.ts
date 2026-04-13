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

  // ---------------------------------------------------------------------------
  // Phase 1 Provider Auth Guidance E2E coverage (v1.16.0+)
  //
  // The fixture always launches with a fresh empty userDataDir, so the app
  // enters the onboarding flow on every test. This gives us a clean surface
  // to exercise the ProviderHelpPanel, the Outlook OAuth2-gated disabled
  // state, and the "Use Custom Instead" pivot-to-server shortcut without
  // needing to pre-seed accounts.
  //
  // Each test collects console errors + uncaught exceptions + pageerrors
  // throughout the flow — so any runtime regression in the Phase 1 surfaces
  // (React render error, missing i18n key, IPC channel typo, etc.) fails
  // the release gate before hitting production.
  // ---------------------------------------------------------------------------

  /**
   * Attach console + pageerror listeners and return getters for the captured
   * entries. All tests below use this helper so the failure assertions are
   * uniform.
   */
  function attachConsoleWatchers(page: import('playwright').Page) {
    const errors: LogEntry[] = [];
    const pageErrors: string[] = [];

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

    page.on('pageerror', (err) => {
      pageErrors.push(err.message.slice(0, 500));
    });

    return { errors, pageErrors };
  }

  test('onboarding: Gmail credentials flow renders ProviderHelpPanel and discloses steps', async ({
    page,
  }) => {
    const { errors, pageErrors } = attachConsoleWatchers(page);

    await page.waitForSelector('#root', { timeout: 15000 });

    // Welcome → provider step
    await page.getByText('Get Started', { exact: true }).click();
    await expect(page.getByText('Choose your email provider')).toBeVisible();

    // All 6 visible presets must render as clickable cards
    for (const label of [
      'Gmail',
      'Outlook.com (Personal)',
      'Microsoft 365 (Work/School)',
      'Yahoo Mail',
      'iCloud Mail',
      'Other / Custom',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Pick Gmail → credentials step
    await page.getByText('Gmail', { exact: true }).click();

    // ProviderHelpPanel with Gmail short note is visible (password-supported auth model)
    await expect(
      page.getByText(/Gmail accepts App Passwords/i)
    ).toBeVisible();

    // The Gmail preset must render an email + password form (not the OAuth2 disabled state)
    await expect(page.getByLabel(/email/i).first()).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();

    // Disclosure button is present and collapsed (aria-expanded="false")
    const disclosure = page.getByRole('button', { name: 'Show steps' });
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    // Click to expand → button flips to "Hide steps" and the ordered list mounts
    await disclosure.click();
    await expect(
      page.getByRole('button', { name: 'Hide steps' })
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('list').first()).toBeVisible();

    // Five Gmail steps from providerHelp.gmail.steps in en.json
    const steps = page.getByRole('list').first().getByRole('listitem');
    await expect(steps).toHaveCount(5);

    // "Open official page" button is rendered (but not clicked — clicking
    // invokes shell.openExternal which launches a real browser)
    await expect(
      page.getByRole('button', { name: 'Open official page' })
    ).toBeVisible();

    expect(pageErrors, 'Uncaught page errors in Gmail onboarding flow').toHaveLength(0);
    expect(errors, 'Console errors in Gmail onboarding flow').toHaveLength(0);
  });

  test('onboarding: Outlook Personal renders Microsoft OAuth button + Use Custom Instead pivot', async ({
    page,
  }) => {
    const { errors, pageErrors } = attachConsoleWatchers(page);

    await page.waitForSelector('#root', { timeout: 15000 });

    // Welcome → provider → Outlook Personal
    await page.getByText('Get Started', { exact: true }).click();
    await page.getByText('Outlook.com (Personal)', { exact: true }).click();

    // Amber warning banner (role="alert") from ProviderHelpPanel still present
    // for personal Outlook.com (April 30 2026 deadline).
    const warning = page.getByRole('alert');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/Microsoft is removing password-based SMTP/i);

    // Task 20: OAuth button region is exposed as role="status" / aria-live="polite"
    // so assistive tech announces the OAuth-only state when it appears. The
    // actual Microsoft sign-in button lives inside this region. Its label key
    // is `oauth.button.microsoft` — Task 25 will populate the real translation.
    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('aria-live', 'polite');
    // The OAuth button is rendered inside the status region. We assert the
    // button is present by its aria-busy attribute (set to undefined when idle,
    // so we check for the presence of any button inside the status region).
    await expect(status.locator('button').first()).toBeVisible();

    // Password form must NOT be rendered while the flow is OAuth-only
    await expect(page.getByLabel(/password/i)).toHaveCount(0);

    // The "Use Other / Custom instead" escape hatch is still present for users
    // who do not want to complete the OAuth flow.
    const pivotButton = page.getByText('Use Other / Custom instead', { exact: true });
    await expect(pivotButton).toBeVisible();

    // Clicking it must jump straight to the server-settings step (custom has no hosts)
    await pivotButton.click();

    // The OAuth status region is gone and the server settings heading is present
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByText(/Server settings/i).first()).toBeVisible();

    expect(pageErrors, 'Uncaught page errors in Outlook OAuth flow').toHaveLength(0);
    expect(errors, 'Console errors in Outlook OAuth flow').toHaveLength(0);
  });

  test('onboarding: Microsoft 365 business renders Microsoft OAuth button without legacy warning banner', async ({
    page,
  }) => {
    const { errors, pageErrors } = attachConsoleWatchers(page);

    await page.waitForSelector('#root', { timeout: 15000 });

    await page.getByText('Get Started', { exact: true }).click();
    await page.getByText('Microsoft 365 (Work/School)', { exact: true }).click();

    // M365 renders the OAuth button region but NOT the April 30 2026 warning
    // banner (that deadline only applies to personal Outlook.com accounts).
    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status.locator('button').first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Password form hidden, fallback button present
    await expect(page.getByLabel(/password/i)).toHaveCount(0);
    await expect(
      page.getByText('Use Other / Custom instead', { exact: true })
    ).toBeVisible();

    expect(pageErrors, 'Uncaught page errors in Microsoft 365 flow').toHaveLength(0);
    expect(errors, 'Console errors in Microsoft 365 flow').toHaveLength(0);
  });
});
