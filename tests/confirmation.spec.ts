import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test('clear is immediate and undoable; close confirmation defaults to Cancel and traps focus', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  pdf.addPage([612, 792]).drawText('Secret', { x: 72, y: 700, size: 20, font });
  await page.goto('/');

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
    name: 'confirmation.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });

  const clear = page.getByRole('button', { name: 'Clear all marks', exact: true });
  const undo = page.getByRole('button', { name: 'Undo last edit' });

  await expect(clear).toBeDisabled();
  await page.locator('.textLayer span').filter({ hasText: 'Secret' }).dblclick();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const clearBounds = (await clear.boundingBox())!,
    undoBounds = (await undo.boundingBox())!;

  expect(clearBounds.x + clearBounds.width).toBeLessThanOrEqual(undoBounds.x);
  await clear.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.redaction-mark')).toHaveCount(0);
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);

  const close = page
    .locator('.document-bar')
    .getByRole('button', { name: 'Close PDF', exact: true });
  const closeBounds = (await close.boundingBox())!;
  const expandBounds = (await page
    .getByRole('button', { name: 'Expand editor', exact: true })
    .boundingBox())!;

  expect(closeBounds.x + closeBounds.width).toBeLessThanOrEqual(expandBounds.x);
  await close.click();
  const dialog = page.getByRole('dialog', { name: 'Close this PDF?' });

  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });

  await expect(cancel).toBeFocused();

  for (const key of [
    'Tab',
    'Tab',
    'Tab',
    'Tab',
    'Shift+Tab',
    'Shift+Tab',
    'Shift+Tab',
    'Shift+Tab',
  ]) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await expect
    .poll(() =>
      page.locator('dialog').evaluate((el) => getComputedStyle(el, '::backdrop').backgroundColor),
    )
    .toBe('rgba(12, 30, 22, 0.5)');

  await page.screenshot({ path: info.outputPath('confirmation.png'), fullPage: true });
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await expect(close).toBeFocused();
  await close.click();
  await dialog.getByRole('button', { name: 'Cancel closing PDF' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await close.click();

  // Clicking dialog text is not a backdrop dismissal.
  await dialog.getByRole('heading').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await close.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.expanded-main')).toHaveCount(1);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await expect(close).toBeFocused();
  await close.click();
  await cancel.click();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await close.click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(cancel).toBeFocused();
  await page.screenshot({ path: info.outputPath('confirmation-mobile.png'), fullPage: true });
  await cancel.click();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await close.click();
  await dialog.getByRole('button', { name: 'Close PDF', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.document-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose a PDF', exact: true })).toBeFocused();
});
