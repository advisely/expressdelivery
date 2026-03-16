import { test, expect } from './fixtures/electron-app.js';

test.describe('Application Launch', () => {
  test('app window opens and shows content', async ({ page }) => {
    // The app should show either onboarding (no accounts) or main view
    const title = await page.title();
    expect(title).toBeTruthy();

    // Wait for React to mount
    await page.waitForSelector('#root', { timeout: 10000 });

    // Should have some visible content
    const rootContent = await page.locator('#root').textContent();
    expect(rootContent).toBeTruthy();
  });
});
