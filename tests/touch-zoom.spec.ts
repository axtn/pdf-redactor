import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test('mobile pinch zoom is local, cancels editing, pans, resets, and keeps redactions aligned', async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);

  first.drawText('Secret', { x: 72, y: 700, size: 20, font });
  first.drawText('Public', { x: 72, y: 600, size: 20, font });
  await page.goto('/');

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
    name: 'touch.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });

  const text = page.locator('.textLayer span').filter({ hasText: 'Secret' });

  await text.scrollIntoViewIfNeeded();
  const initial = (await page.locator('.pdf-page').boundingBox())!;
  const word = (await text.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const points = [
    { id: 1, x: word.x + 8, y: word.y + word.height / 2 },
    { id: 2, x: word.x + 88, y: word.y + word.height / 2 },
  ];
  const midpoint = { x: (points[0].x + points[1].x) / 2, y: points[0].y };
  const position = {
    x: (midpoint.x - initial.x) / initial.width,
    y: (midpoint.y - initial.y) / initial.height,
  };

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });

  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { ...points[0], x: points[0].x - i * 5 },
        { ...points[1], x: points[1].x + i * 5 },
      ],
    });
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('button', { name: 'Fit PDF to viewer' })).toHaveText('200%');
  await expect(page.locator('.redaction-mark')).toHaveCount(0);
  await expect(page.locator('.drawing-mark')).toHaveCount(0);
  const zoomed = (await page.locator('.pdf-page').boundingBox())!;

  expect(zoomed.width / initial.width).toBeCloseTo(2, 1);
  expect(Math.abs(zoomed.x + position.x * zoomed.width - midpoint.x)).toBeLessThan(3);
  expect(Math.abs(zoomed.y + position.y * zoomed.height - midpoint.y)).toBeLessThan(3);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await expect
    .poll(() => page.locator('.pdf-page canvas').evaluate((el) => (el as HTMLCanvasElement).width))
    .toBeGreaterThan(900);

  // Two fingers at a constant distance pan the document, without altering zoom or marks.
  const bounds = (await page.locator('.pages').boundingBox())!;
  const y = Math.max(20, bounds.y + 90),
    x = bounds.x + bounds.width / 2;
  const scrollBefore = await page.locator('.pages').evaluate((el) => el.scrollLeft);
  const pair = [
    { id: 3, x: x - 30, y },
    { id: 4, x: x + 30, y },
  ];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair });

  for (let i = 1; i <= 5; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pair.map((p) => ({ ...p, x: p.x - i * 8 })),
    });
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('button', { name: 'Fit PDF to viewer' })).toHaveText('200%');

  expect(await page.locator('.pages').evaluate((el) => el.scrollLeft)).toBeGreaterThan(
    scrollBefore + 20,
  );

  await expect(page.locator('.redaction-mark')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fit PDF to viewer' }).click();
  await expect(page.getByRole('button', { name: 'Fit PDF to viewer' })).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom in PDF' }).click();
  await expect(page.getByRole('button', { name: 'Fit PDF to viewer' })).toHaveText('125%');
  await text.scrollIntoViewIfNeeded();
  const selectionBounds = (await text.boundingBox())!;
  const touchStart = {
    id: 5,
    x: selectionBounds.x + 1,
    y: selectionBounds.y + selectionBounds.height / 2,
  };

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchStart] });

  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { ...touchStart, x: selectionBounds.x + 1 + ((selectionBounds.width - 2) * i) / 10 },
      ],
    });
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const mark = (await page.locator('.redaction-mark').boundingBox())!,
    selected = (await text.boundingBox())!;

  // Allow layout rounding without reintroducing selection padding.
  expect(mark.x).toBeLessThanOrEqual(selected.x + 0.1);
  expect(mark.y).toBeLessThanOrEqual(selected.y + 0.1);
  expect(mark.x + mark.width).toBeGreaterThanOrEqual(selected.x + selected.width - 0.1);
  await page.screenshot({ path: info.outputPath('mobile-zoom.png'), fullPage: true });
  const pending = page.waitForEvent('download');

  await page.getByRole('button', { name: 'Download redacted PDF' }).click();
  const download = await pending;

  await download.saveAs(info.outputPath('touch-redacted.pdf'));
  const bytes = await import('node:fs/promises').then((fs) =>
    fs.readFile(info.outputPath('touch-redacted.pdf')),
  );

  await page
    .getByLabel('Choose PDF', { exact: true })
    .setInputFiles({ name: 'export.pdf', mimeType: 'application/pdf', buffer: bytes });

  await expect(page.locator('.textLayer')).toContainText('Public');
  await expect(page.locator('.textLayer')).not.toContainText('Secret');
  await expect(page.getByRole('button', { name: 'Fit PDF to viewer' })).toHaveText('100%');
  expect(errors).toEqual([]);
});
