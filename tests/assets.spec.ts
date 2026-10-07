import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Run separately with PDF_REDACTOR_TEST_CDN=1 and
// NEXT_PUBLIC_PDF_ASSET_BASE_URL=http://127.0.0.1:3012/pdf/.
test.describe('external PDF asset origin', () => {
  test.skip(
    !process.env.PDF_REDACTOR_TEST_CDN,
    'Enable the separate-origin asset test explicitly.',
  );

  let server: Server;

  test.beforeAll(async () => {
    const root = resolve('pdf-assets');

    server = createServer(async (request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const file = resolve(root, decodeURIComponent(pathname.slice('/pdf/'.length)));

      if (!pathname.startsWith('/pdf/') || !file.startsWith(`${root}${sep}`)) {
        response.writeHead(404).end();

        return;
      }

      try {
        const bytes = await readFile(file);
        const types: Record<string, string> = {
          '.js': 'application/javascript',
          '.mjs': 'application/javascript',
          '.wasm': 'application/wasm',
          '.ttf': 'font/ttf',
        };

        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        });

        response.end(bytes);
      } catch {
        response.writeHead(404).end();
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(3012, '127.0.0.1', resolve);
    });
  });

  test.afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('uses the public prefix for engines, but keeps the worker loader and PDF data local', async ({
    page,
  }, info) => {
    const requests: { url: string; method: string }[] = [];
    const errors: string[] = [];

    page.on('request', (request) =>
      requests.push({ url: request.url(), method: request.method() }),
    );

    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    expect(requests.some((request) => request.url.startsWith('http://127.0.0.1:3012'))).toBe(false);
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);

    source.addPage([612, 792]).drawText('External assets work', { x: 72, y: 700, size: 20, font });

    await page.getByLabel('Choose PDF', { exact: true }).setInputFiles({
      name: 'cdn-test.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await source.save()),
    });

    await expect(page.locator('.textLayer')).toContainText('External assets work');

    await expect
      .poll(() =>
        requests.some(
          (request) => request.url === 'http://127.0.0.1:3012/pdf/mupdf/mupdf-wasm.wasm',
        ),
      )
      .toBe(true);

    const download = page.waitForEvent('download');

    await page.getByRole('button', { name: 'Download redacted PDF' }).click();
    const result = await download;

    await result.saveAs(info.outputPath('cdn-output.pdf'));

    expect(
      requests.some(
        (request) => request.url === 'http://127.0.0.1:3012/pdf/pdfjs/pdf.worker.min.mjs',
      ),
    ).toBe(true);

    expect(
      requests.some((request) => request.url === 'http://127.0.0.1:3012/pdf/mupdf/mupdf.js'),
    ).toBe(true);

    expect(
      requests.some(
        (request) => request.url === `${new URL(page.url()).origin}/redaction-worker.mjs`,
      ),
    ).toBe(true);

    expect(requests.some((request) => request.url.includes('3012/pdf/redaction-worker'))).toBe(
      false,
    );

    expect(
      requests.some(
        (request) => request.url === `${new URL(page.url()).origin}/mupdf/mupdf-wasm.wasm`,
      ),
    ).toBe(false);

    expect(
      requests
        .filter((request) => request.url.startsWith('http://127.0.0.1:3012'))
        .every((request) => request.method === 'GET'),
    ).toBe(true);

    expect(errors).toEqual([]);
  });
});
