import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  PDFDocument,
  PDFRawStream,
  PDFName,
  PDFDict,
  decodePDFRawStream,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  PDFOperator,
  PDFOperatorNames,
} from 'pdf-lib';

async function redactInWorker(
  page: Page,
  bytes: Uint8Array,
  marks: { page: number; x: number; y: number; w: number; h: number }[],
) {
  return new Uint8Array(
    await page.evaluate(
      ({ bytes, marks }) =>
        new Promise<number[]>((resolve, reject) => {
          const worker = new Worker('/redaction-worker.mjs', { type: 'module' });

          worker.onmessage = ({ data }) => {
            if (data.type === 'result') {
              resolve(Array.from(new Uint8Array(data.bytes)));
              worker.terminate();
            }

            if (data.type === 'error') {
              reject(new Error(data.message));
              worker.terminate();
            }
          };

          worker.onerror = (event) => {
            reject(new Error(event.message));
            worker.terminate();
          };

          worker.postMessage({ bytes: new Uint8Array(bytes).buffer, marks });
        }),
      { bytes: Array.from(bytes), marks },
    ),
  );
}

test('redacts rotated, cropped, nested, and scanned content while preserving unrelated text and image instances', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto('/');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');

    canvas.width = 200;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 100);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(100, 0, 100, 100);

    return canvas.toDataURL('image/png').split(',')[1];
  });
  const source = await PDFDocument.create();

  source.setAuthor('Private author');
  source.setTitle('Private title');
  const font = await source.embedFont(StandardFonts.Helvetica);
  const rotated = source.addPage([612, 792]);

  rotated.setRotation(degrees(90));
  rotated.drawText('ROTATED SECRET', { x: 72, y: 700, size: 20, font });
  rotated.drawText('Rotated public', { x: 72, y: 600, size: 20, font });
  const cropped = source.addPage([612, 792]);

  cropped.setCropBox(50, 100, 500, 600);
  cropped.drawText('CROPPED SECRET', { x: 100, y: 600, size: 20, font });
  cropped.drawText('Cropped public', { x: 100, y: 500, size: 20, font });
  const image = await source.embedPng(Buffer.from(png, 'base64'));
  const scanned = source.addPage([612, 792]);

  scanned.drawImage(image, { x: 72, y: 400, width: 200, height: 100 });
  scanned.drawText('OCR SECRET', { x: 75, y: 430, size: 12, font, opacity: 0 });
  scanned.drawText('Scan public', { x: 72, y: 300, size: 20, font });

  // A vector that intersects the box must be removed in its entirety.
  scanned.drawRectangle({ x: 65, y: 480, width: 180, height: 5, color: rgb(0, 1, 0) });
  const reused = source.addPage([612, 792]);

  reused.drawImage(image, { x: 72, y: 400, width: 200, height: 100 });
  reused.drawText('Reused public', { x: 72, y: 300, size: 20, font });

  // Nested form XObject content must be redacted recursively.
  const nestedDoc = await PDFDocument.create();
  const nestedFont = await nestedDoc.embedFont(StandardFonts.Helvetica);
  const nestedPage = nestedDoc.addPage([300, 100]);

  nestedPage.drawText('NESTED SECRET', { x: 10, y: 40, size: 20, font: nestedFont });
  const [embedded] = await source.embedPdf(await nestedDoc.save());
  const nested = source.addPage([612, 792]);

  nested.drawPage(embedded, { x: 72, y: 400 });
  nested.drawText('Nested public', { x: 72, y: 300, size: 20, font });

  // Replacement accessibility text must not survive in a fresh drawing-only document.
  const tagged = source.addPage([612, 792]);

  tagged.node.Resources()!.set(
    PDFName.of('Properties'),
    source.context.obj({
      Replacement: {
        ActualText: PDFString.of('REPLACEMENT SECRET'),
        Alt: PDFString.of('ALT SECRET'),
      },
    }),
  );

  tagged.pushOperators(
    pushGraphicsState(),
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of('Span'),
      PDFName.of('Replacement'),
    ]),
  );

  tagged.drawText('Visible public', { x: 72, y: 600, size: 20, font });
  tagged.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent), popGraphicsState());
  const layered = source.addPage([612, 792]);
  const ocg = source.context.register(
    source.context.obj({ Type: 'OCG', Name: PDFString.of('Private layer') }),
  );

  source.catalog.set(
    PDFName.of('OCProperties'),
    source.context.obj({ OCGs: [ocg], D: { BaseState: 'ON', OFF: [ocg], Order: [ocg] } }),
  );

  layered.node.Resources()!.set(PDFName.of('Properties'), source.context.obj({ Private: ocg }));

  layered.pushOperators(
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of('OC'),
      PDFName.of('Private'),
    ]),
  );

  layered.drawText('HIDDEN LAYER SECRET', { x: 72, y: 700, size: 20, font });
  layered.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  layered.drawText('Layer public', { x: 72, y: 600, size: 20, font });
  const xmp = source.context.register(
    source.context.stream('<x:xmpmeta>PRIVATE XMP</x:xmpmeta>', {
      Type: 'Metadata',
      Subtype: 'XML',
    }),
  );

  source.catalog.set(PDFName.of('Metadata'), xmp);
  await source.attach(Buffer.from('PRIVATE ATTACHMENT'), 'private.txt');
  const sourceBytes = await source.save();

  await writeFile(info.outputPath('source.pdf'), sourceBytes);
  const outputBytes = await redactInWorker(page, sourceBytes, [
    { page: 1, x: 675 / 792, y: 65 / 612, w: 50 / 792, h: 230 / 612 },
    { page: 2, x: 45 / 500, y: 75 / 600, w: 220 / 500, h: 35 / 600 },
    { page: 3, x: 70 / 612, y: 290 / 792, w: 103 / 612, h: 105 / 792 },
    { page: 5, x: 70 / 612, y: 290 / 792, w: 300 / 612, h: 110 / 792 },
  ]);

  await writeFile(info.outputPath('edge-cases.pdf'), outputBytes);
  const output = await PDFDocument.load(outputBytes, { updateMetadata: false });

  expect(output.getPageCount()).toBe(7);
  expect(output.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  expect(output.getPage(1).getSize()).toEqual({ width: 500, height: 600 });
  expect(output.context.trailerInfo.Info).toBeUndefined();
  expect(output.catalog.has(PDFName.of('Metadata'))).toBe(false);
  expect(output.catalog.has(PDFName.of('Names'))).toBe(false);
  expect(output.catalog.has(PDFName.of('StructTreeRoot'))).toBe(false);

  for (const [, object] of output.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) {
      expect(object.has(PDFName.of('Metadata'))).toBe(false);
    }
  }

  // Inspect the actual embedded image, not just the black overlay drawn above it.
  for (const [pageIndex, expectedLeft] of [
    [2, [255, 255, 255]],
    [3, [255, 0, 0]],
  ] as const) {
    const images = output
      .getPage(pageIndex)
      .node.Resources()!
      .lookup(PDFName.of('XObject'), PDFDict);
    const raw = images.lookup(images.keys()[0]) as PDFRawStream;
    const pixels = decodePDFRawStream(raw).decode();

    expect(Array.from(pixels.slice((50 * 200 + 20) * 3, (50 * 200 + 20) * 3 + 3))).toEqual(
      expectedLeft,
    );

    expect(Array.from(pixels.slice((50 * 200 + 150) * 3, (50 * 200 + 150) * 3 + 3))).toEqual([
      0, 0, 255,
    ]);
  }

  await page.getByLabel('Choose PDF').setInputFiles({
    name: 'edge-cases-redacted.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(outputBytes),
  });

  await expect(page.locator('.textLayer').nth(0)).toContainText('Rotated public');
  await expect(page.locator('.textLayer').nth(1)).toContainText('Cropped public');
  await expect(page.locator('.textLayer').nth(2)).toContainText('Scan public');
  await expect(page.locator('.textLayer').nth(3)).toContainText('Reused public');
  await expect(page.locator('.textLayer').nth(4)).toContainText('Nested public');
  await expect(page.locator('.textLayer').nth(5)).toContainText('Visible public');
  await expect(page.locator('.textLayer').nth(6)).toContainText('Layer public');
  await expect(page.locator('.pages')).not.toContainText('SECRET');
  await page.screenshot({ path: info.outputPath('edge-cases.png'), fullPage: true });

  // Inspect pixels from the independent PDF.js rendering of the exported PDF.
  const pixel = (index: number, x: number, y: number) =>
    page
      .locator('.pdf-page canvas')
      .nth(index)
      .evaluate(
        (element, point) => {
          const canvas = element as HTMLCanvasElement;

          return Array.from(
            canvas
              .getContext('2d')!
              .getImageData(
                Math.floor(point.x * canvas.width),
                Math.floor(point.y * canvas.height),
                1,
                1,
              ).data,
          );
        },
        { x, y },
      );

  await expect.poll(() => pixel(2, 100 / 612, 350 / 792)).toEqual([0, 0, 0, 255]);
  await expect.poll(() => pixel(2, 220 / 612, 350 / 792)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => pixel(3, 100 / 612, 350 / 792)).toEqual([255, 0, 0, 255]);

  // The portion of the green vector outside the box was removed too.
  await expect.poll(() => pixel(2, 220 / 612, 309 / 792)).toEqual([0, 0, 255, 255]);
  await page.screenshot({ path: info.outputPath('edge-cases.png'), fullPage: true });
});

test('preserves business-card artwork inside transparency Form streams', async ({ page }) => {
  await page.goto('/');
  const source = await PDFDocument.create();
  const card = source.addPage([252, 144]);

  card.node.set(
    PDFName.of('Group'),
    source.context.obj({ Type: 'Group', S: 'Transparency', I: true, CS: 'DeviceRGB' }),
  );

  card.drawRectangle({ x: 0, y: 0, width: 252, height: 144, color: rgb(0.95, 0.94, 0.8) });

  card.drawRectangle({
    x: 20,
    y: 20,
    width: 210,
    height: 100,
    color: rgb(0.1, 0.4, 0.2),
    opacity: 0.8,
  });

  const font = await source.embedFont(StandardFonts.Helvetica);

  card.drawText('Business card', { x: 40, y: 70, font, size: 18, color: rgb(1, 1, 1) });
  source.setAuthor('Private designer');
  const bytes = await redactInWorker(page, await source.save(), []);
  const output = await PDFDocument.load(bytes, { updateMetadata: false });

  expect(output.context.trailerInfo.Info).toBeUndefined();
  const objects = output.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const form = objects.lookup(objects.keys()[0]);

  expect(form).toBeInstanceOf(PDFRawStream);

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
    name: 'transparent-card.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });

  await expect(page.locator('.textLayer')).toContainText('Business card');

  await expect
    .poll(() =>
      page.locator('.pdf-page canvas').evaluate((element) => {
        const canvas = element as HTMLCanvasElement;

        return Array.from(canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data);
      }),
    )
    .toEqual([242, 240, 204, 255]);
});

test('redacts white text without losing an opaque page background', async ({ page }) => {
  await page.goto('/');
  const source = await PDFDocument.create();
  const card = source.addPage([252, 144]);

  card.node.set(
    PDFName.of('Group'),
    source.context.obj({ Type: 'Group', S: 'Transparency', I: true, CS: 'DeviceRGB' }),
  );

  card.drawRectangle({ x: 0, y: 0, width: 252, height: 144, color: rgb(0.2, 0.4, 0.3) });
  const font = await source.embedFont(StandardFonts.Helvetica);

  card.drawText('PRIVATE TITLE', { x: 40, y: 80, font, size: 18, color: rgb(1, 1, 1) });
  card.drawText('Public caption', { x: 40, y: 30, font, size: 18, color: rgb(1, 1, 1) });
  const bytes = await redactInWorker(page, await source.save(), [
    { page: 1, x: 35 / 252, y: 44 / 144, w: 190 / 252, h: 30 / 144 },
  ]);

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
    name: 'redacted-card.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });

  await expect(page.locator('.textLayer')).toContainText('Public caption');
  await expect(page.locator('.textLayer')).not.toContainText('PRIVATE');
  const pixel = (x: number, y: number) =>
    page.locator('.pdf-page canvas').evaluate(
      (element, point) => {
        const canvas = element as HTMLCanvasElement;

        return Array.from(
          canvas
            .getContext('2d')!
            .getImageData(
              Math.floor(point.x * canvas.width),
              Math.floor(point.y * canvas.height),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );

  await expect.poll(() => pixel(0.02, 0.02)).toEqual([51, 102, 76, 255]);
  await expect.poll(() => pixel(0.5, 0.4)).toEqual([0, 0, 0, 255]);
});

test('redacts the supplied designed PDF while preserving its colored background and public text', async ({
  page,
}, info) => {
  const path = process.env.PDF_REDACTOR_DESIGN_PDF;

  test.skip(!path, 'Set PDF_REDACTOR_DESIGN_PDF for the supplied-card regression.');
  await page.goto('/');
  const source = new Uint8Array(await import('node:fs/promises').then((fs) => fs.readFile(path!)));
  const bytes = await redactInWorker(page, source, [
    { page: 1, x: 0.23, y: 0.23, w: 0.55, h: 0.4 },
  ]);

  await writeFile(info.outputPath('redacted-design.pdf'), bytes);

  await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
    name: 'redacted-design.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(bytes),
  });

  await expect(page.locator('.textLayer')).toContainText('Weddings');

  await expect
    .poll(() =>
      page
        .locator('.textLayer')
        .textContent()
        .then((text) => text?.replace(/\s/g, '').toLowerCase()),
    )
    .not.toContain('bloom');

  const pixel = (x: number, y: number) =>
    page.locator('.pdf-page canvas').evaluate(
      (element, point) => {
        const canvas = element as HTMLCanvasElement;

        return Array.from(
          canvas
            .getContext('2d')!
            .getImageData(
              Math.floor(point.x * canvas.width),
              Math.floor(point.y * canvas.height),
              1,
              1,
            ).data,
        );
      },
      { x, y },
    );

  await expect.poll(() => pixel(0.5, 0.05)).toEqual([147, 167, 138, 255]);
  await expect.poll(() => pixel(0.5, 0.4)).toEqual([0, 0, 0, 255]);
  await page.screenshot({ path: info.outputPath('redacted-design.png'), fullPage: true });
});
