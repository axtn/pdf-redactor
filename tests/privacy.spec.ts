import { expect, test } from '@playwright/test';

test('privacy policy stays inside the viewport on mobile and desktop', async ({ page }) => {
  for (const width of [320, 360, 390, 540, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByText('Privacy policy', { exact: true }).click();

    const policy = page.locator('.privacy-policy p');

    await expect(policy).toBeVisible();
    const bounds = await policy.boundingBox();

    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});
