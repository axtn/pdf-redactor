/** Public asset prefix. A blank value serves the assets from the app itself. */
const assetBaseUrl = (process.env.NEXT_PUBLIC_PDF_ASSET_BASE_URL ?? '').trim().replace(/\/+$/, '');

export function pdfAssetUrl(path: string): string {
  return `${assetBaseUrl}/${path.replace(/^\/+/, '')}`;
}

export function redactionEngineUrl(): string {
  return new URL(pdfAssetUrl('mupdf/mupdf.js'), window.location.href).href;
}
