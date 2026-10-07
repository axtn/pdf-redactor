import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, degrees } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  doc.setAuthor('Sensitive Author');
  doc.setTitle('Confidential title');
  doc.setKeywords(['private']);
  const page = doc.addPage([612, 792]);

  page.drawText('SECRET ACCOUNT 12345', { x: 72, y: 700, size: 20, font });
  page.drawText('Public information', { x: 72, y: 600, size: 20, font });
  const rotated = doc.addPage([612, 792]);

  rotated.setRotation(degrees(90));
  rotated.drawText('Second page', { x: 72, y: 700, size: 20, font });
  await doc.attach(new Uint8Array([115, 101, 99, 114, 101, 116]), 'secret.txt');

  return Buffer.from(await doc.save());
}

test('browser-only text and box redaction produces a fresh sanitized PDF', async ({
  page,
}, info) => {
  const errors: string[] = [];

  page.on('pageerror', (e) => errors.push(e.message));
  const requests: string[] = [];

  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');

  await expect(page.getByRole('link', { name: 'axtn.io home' })).toHaveAttribute(
    'href',
    'https://axtn.io',
  );

  expect(requests.some((url) => url.includes('/mupdf/'))).toBe(false);
  expect(requests.some((url) => url.endsWith('/redaction-worker.mjs'))).toBe(false);

  await page.getByLabel('Choose PDF').setInputFiles({
    name: 'confidential.pdf',
    mimeType: 'application/pdf',
    buffer: await fixture(),
  });

  await expect(page.locator('.textLayer').first().locator('span').first()).toBeVisible();

  await expect
    .poll(() => requests.filter((url) => url.endsWith('/mupdf/mupdf-wasm.wasm')).length)
    .toBe(1);

  await page.getByRole('button', { name: 'Inspect original metadata' }).click();
  await expect(page.locator('.metadata')).toContainText('Sensitive Author');
  const secret = page
    .locator('.textLayer')
    .first()
    .locator('span')
    .filter({ hasText: 'SECRET ACCOUNT' });

  await secret.scrollIntoViewIfNeeded();
  const textRect = (await secret.boundingBox())!;

  await page.mouse.move(textRect.x - 5, textRect.y - 3);
  await page.mouse.down();

  await page.mouse.move(textRect.x + textRect.width + 8, textRect.y + textRect.height / 2, {
    steps: 12,
  });

  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Draw a box' }).click();
  await page.locator('.pdf-page').first().scrollIntoViewIfNeeded();
  const rect = await page.locator('.pdf-page').first().boundingBox();

  await page.mouse.move(rect!.x + rect!.width * 0.1, rect!.y + rect!.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(rect!.x + rect!.width * 0.48, rect!.y + rect!.height * 0.27);
  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo last edit' }).click();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const redaction = await page.locator('.redaction-mark').evaluate((el) => ({
    x: parseFloat((el as HTMLElement).style.left) / 100,
    y: parseFloat((el as HTMLElement).style.top) / 100,
    w: parseFloat((el as HTMLElement).style.width) / 100,
    h: parseFloat((el as HTMLElement).style.height) / 100,
  }));
  const pending = page.waitForEvent('download');

  await page.getByRole('button', { name: 'Download redacted PDF' }).click();
  const download = await pending;
  const path = info.outputPath('redacted.pdf');

  await download.saveAs(path);

  // Export reuses the worker started on upload, rather than loading a second engine.
  expect(requests.filter((url) => url.endsWith('/redaction-worker.mjs'))).toHaveLength(1);
  const bytes = await readFile(path);
  const output = await PDFDocument.load(bytes, { updateMetadata: false });

  expect(output.getPageCount()).toBe(2);
  expect(output.context.trailerInfo.Info).toBeUndefined();
  expect(output.catalog.has(PDFName.of('Metadata'))).toBe(false);
  expect(output.catalog.has(PDFName.of('Names'))).toBe(false);

  for (const p of output.getPages()) {
    expect(p.node.has(PDFName.of('Annots'))).toBe(false);
    expect(p.node.Resources()!.has(PDFName.of('Font'))).toBe(true);
  }

  await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true });

  await page
    .getByLabel('Choose PDF')
    .setInputFiles({ name: 'redacted.pdf', mimeType: 'application/pdf', buffer: bytes });

  await expect(page.locator('.document-bar')).toContainText('redacted.pdf');
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
  await expect(page.locator('.textLayer').first()).toContainText('Public information');
  await expect(page.locator('.textLayer').first()).not.toContainText('SECRET ACCOUNT');

  await expect
    .poll(() =>
      page
        .locator('.pdf-page canvas')
        .first()
        .evaluate((el, mark) => {
          const canvas = el as HTMLCanvasElement;
          const rgba = canvas
            .getContext('2d')!
            .getImageData(
              Math.floor((mark.x + mark.w / 2) * canvas.width),
              Math.floor((mark.y + mark.h / 2) * canvas.height),
              1,
              1,
            ).data;

          return Array.from(rgba);
        }, redaction),
    )
    .toEqual([0, 0, 0, 255]);

  await page.screenshot({ path: info.outputPath('export-preview.png'), fullPage: true });
  expect(errors).toEqual([]);

  expect(
    requests.filter(
      (url) => !url.startsWith(new URL(page.url()).origin) && !url.startsWith('blob:'),
    ),
  ).toEqual([]);
});

test('responsive landing and malformed PDF handling', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Redact your PDF' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });

  await page.getByLabel('Choose PDF').setInputFiles({
    name: 'broken.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });

  await expect(page.locator('.message.error')).toContainText('couldn’t open');
  await expect(page.getByRole('button', { name: 'Choose a PDF' })).toBeEnabled();
});

test('metadata checkbox starts checked, can be unchecked, and controls exported metadata', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  const source = await PDFDocument.load(await fixture(), { updateMetadata: false });
  const xmp = source.context.register(
    source.context.stream('<x:xmpmeta>Original private metadata</x:xmpmeta>', {
      Type: 'Metadata',
      Subtype: 'XML',
    }),
  );

  source.catalog.set(PDFName.of('Metadata'), xmp);
  const input = {
    name: 'metadata.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await source.save()),
  };

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles(input);
  const checkbox = page.getByRole('checkbox', { name: 'Remove hidden information' });

  await expect(checkbox).toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();

  await expect(page.locator('#sanitize-description')).toContainText(
    'Keep original document metadata',
  );

  const secret = page
    .locator('.textLayer')
    .first()
    .locator('span')
    .filter({ hasText: 'SECRET ACCOUNT' });

  await secret.scrollIntoViewIfNeeded();
  const rect = (await secret.boundingBox())!;

  await page.mouse.move(rect.x - 4, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width + 4, rect.y + rect.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.redaction-mark')).toHaveCount(1);
  const pending = page.waitForEvent('download');

  await page.getByRole('button', { name: 'Download redacted PDF' }).click();
  const download = await pending;
  const path = info.outputPath('metadata-kept.pdf');

  await download.saveAs(path);
  const outputBytes = await readFile(path);
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false });

  expect(output.context.trailerInfo.Info).toBeDefined();
  expect(output.getAuthor()).toBe('Sensitive Author');
  expect(output.getTitle()).toBe('Confidential title');
  expect(output.catalog.has(PDFName.of('Metadata'))).toBe(true);
  expect(output.catalog.has(PDFName.of('Names'))).toBe(false);

  await page
    .getByLabel('Choose PDF', { exact: true })
    .setInputFiles({ name: 'exported.pdf', mimeType: 'application/pdf', buffer: outputBytes });

  await expect(checkbox).toBeChecked();
  await expect(page.locator('.textLayer').first()).toContainText('Public information');
  await expect(page.locator('.textLayer').first()).not.toContainText('SECRET ACCOUNT');
});
