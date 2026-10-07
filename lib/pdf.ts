import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfAssetUrl, redactionEngineUrl } from './pdf-assets';

export type Mark = { id: string; page: number; x: number; y: number; w: number; h: number };

export async function loadPdf(data: Uint8Array) {
  const pdfjs = await import('pdfjs-dist');

  pdfjs.GlobalWorkerOptions.workerSrc = pdfAssetUrl('pdfjs/pdf.worker.min.mjs');
  const task = pdfjs.getDocument({
    data,
    cMapUrl: pdfAssetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: pdfAssetUrl('pdfjs/standard_fonts/'),
    wasmUrl: pdfAssetUrl('pdfjs/wasm/'),
  });

  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();

    throw error;
  }
}

let warming: { worker: Worker; ready: Promise<Worker>; reject: (error: Error) => void } | null =
  null;

export function preloadRedactionEngine(): Promise<Worker> {
  if (warming) {
    return warming.ready;
  }

  const worker = new Worker('/redaction-worker.mjs', { type: 'module' });
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<Worker>((resolve, reject) => {
    rejectReady = reject;

    const fail = (message: string) => {
      worker.terminate();

      if (warming?.worker === worker) {
        warming = null;
      }

      reject(new Error(message));
    };

    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        resolve(worker);
      } else if (data.type === 'error') {
        fail(data.message);
      }
    };

    worker.onerror = () =>
      fail('The local redaction engine could not start. Reload and try again.');

    worker.onmessageerror = () => fail('The redaction engine returned an invalid response.');
  });

  warming = { worker, ready, reject: rejectReady };

  // No document bytes are sent during preparation.
  worker.postMessage({ type: 'preload', engineModuleUrl: redactionEngineUrl() });

  return ready;
}

export function releasePreloadedEngine() {
  if (!warming) {
    return;
  }

  const pending = warming;

  warming = null;
  pending.worker.terminate();
  pending.reject(new Error('Document closed.'));
}

export async function exportPdf(
  doc: PDFDocumentProxy,
  marks: Mark[],
  progress: (page: number) => void,
  removeHiddenInformation = true,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await doc.getData());
  const worker = await preloadRedactionEngine();

  if (warming?.worker === worker) {
    warming = null;
  }

  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        progress(data.page);
      } else if (data.type === 'result') {
        worker.terminate();
        resolve(new Uint8Array(data.bytes));
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.message));
      }
    };

    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The local redaction engine could not start. Reload and try again.'));
    };

    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error('The redaction engine returned an invalid result. No file was exported.'));
    };

    worker.postMessage(
      {
        bytes: bytes.buffer,
        marks,
        removeHiddenInformation,
        engineModuleUrl: redactionEngineUrl(),
      },
      [bytes.buffer],
    );
  });
}
