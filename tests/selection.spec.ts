import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

test('loaded editor supports word selection, reverse drags, and release outside the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pdfPage = doc.addPage([612, 792]);

  pdfPage.drawText('Private account number', { x: 72, y: 700, size: 20, font });
  pdfPage.drawText('Another sensitive line', { x: 72, y: 660, size: 20, font });
  const rotated = doc.addPage([612, 792]);

  rotated.setRotation(degrees(90));
  rotated.drawText('Rotated account', { x: 72, y: 700, size: 20, font });
  await page.goto('/');

  await page.getByLabel('Choose PDF').setInputFiles({
    name: 'selection.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });

  const line = page.locator('.textLayer span').filter({ hasText: 'Private account number' });

  await line.scrollIntoViewIfNeeded();
  const bounds = (await line.boundingBox())!;

  await page.mouse.dblclick(bounds.x + bounds.width * 0.45, bounds.y + bounds.height / 2);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const wordWidth = await page
    .locator('.redaction-mark')
    .evaluate((el) => parseFloat((el as HTMLElement).style.width));

  expect(wordWidth).toBeLessThan(
    (bounds.width / (await page.locator('.pdf-page').first().boundingBox())!.width) * 100 * 0.65,
  );

  await page.getByRole('button', { name: 'Undo last edit' }).click();
  await line.scrollIntoViewIfNeeded();
  const reverse = (await line.boundingBox())!;

  await page.mouse.move(reverse.x + reverse.width + 5, reverse.y + reverse.height + 3);
  await page.mouse.down();
  await page.mouse.move(reverse.x - 5, reverse.y - 3, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo last edit' }).click();
  await line.scrollIntoViewIfNeeded();
  const outside = (await line.boundingBox())!;
  const area = (await page.locator('.pdf-page').first().boundingBox())!;

  await page.mouse.move(outside.x - 5, outside.y + outside.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width + 15, outside.y + outside.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);

  // A single click must not add a redaction accidentally.
  await page.getByRole('button', { name: 'Undo last edit' }).click();
  await line.click();
  await expect(page.locator('.redaction-mark')).toHaveCount(0);
  const rotatedText = page.locator('.textLayer span').filter({ hasText: 'Rotated account' });

  await rotatedText.scrollIntoViewIfNeeded();
  const glyph = await rotatedText.evaluate((span) => {
    const range = document.createRange();

    range.setStart(span.firstChild!, 1);
    range.setEnd(span.firstChild!, 2);
    const rect = range.getBoundingClientRect();

    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });

  await page.mouse.dblclick(glyph.x, glyph.y);
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const position = await page.locator('.redaction-mark').evaluate((el) => ({
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  }));

  expect(position.x).toBeGreaterThan(80);
  expect(position.y).toBeLessThan(30);
});

test('fragmented example PDF stays confined to the editor and joins split words', async ({
  page,
}, info) => {
  const examplePath = process.env.PDF_REDACTOR_SELECTION_PDF;

  test.skip(
    !examplePath,
    'Set PDF_REDACTOR_SELECTION_PDF to run the supplied-document regression.',
  );

  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles(examplePath!);
  const spans = page.locator('.textLayer').first().locator('span');
  const start = spans.nth(0),
    middle = spans.nth(1),
    end = spans.nth(2);

  await expect(start).toHaveText('P');
  await expect(middle).toHaveText('la');
  await expect(end).toHaveText('sma');
  await middle.scrollIntoViewIfNeeded();
  const alignment = await page
    .locator('.textLayer')
    .first()
    .evaluate((layer) => ({
      layer: layer.getBoundingClientRect().width,
      page: layer.parentElement!.getBoundingClientRect().width,
    }));

  expect(Math.abs(alignment.layer - alignment.page)).toBeLessThan(1);
  const a = (await start.boundingBox())!,
    b = (await end.boundingBox())!;

  await page.mouse.move(a.x + 1, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 15 });
  await expect(page.locator('.text-selection-preview')).toHaveCount(1);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
  const preview = (await page.locator('.text-selection-preview').boundingBox())!;

  expect(preview.width).toBeLessThan(60);

  // Zero-padding rectangles can round by a fraction of a CSS pixel.
  expect(preview.x).toBeLessThanOrEqual(a.x + 0.1);
  expect(preview.x + preview.width).toBeGreaterThanOrEqual(b.x + b.width - 0.1);
  await page.screenshot({ path: info.outputPath('example-drag.png') });
  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await expect(page.locator('.text-selection-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo last edit' }).click();
  await middle.scrollIntoViewIfNeeded();
  await middle.dblclick();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const word = (await page.locator('.redaction-mark').boundingBox())!;

  expect(word.width).toBeGreaterThan(35);
  expect(word.width).toBeLessThan(60);

  // A drag beginning in PDF whitespace must never start native selection of site text.
  const bounds = (await page.locator('.pdf-page').first().boundingBox())!;

  await page.mouse.move(bounds.x + 10, bounds.y + 10);
  await page.mouse.down();
  await page.mouse.move(200, 160, { steps: 10 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});
