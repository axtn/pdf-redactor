# PDF Redactor

Browser-only PDF redaction for **https://pdf.axtn.io**, built with Next.js, React, PDF.js, and MuPDF.js.

## Run and deploy

Use Node.js 22.13+ (or Node.js 24+). Install the locked dependencies:

```sh
npm ci
```

PDF engine assets belong in **`pdf-assets/`**, outside Next.js's `public` directory, when using a bucket. This folder is ignored by Git and is not served by the app. To prepare the files manually from the installed dependencies:

```sh
mkdir -p pdf-assets/pdfjs pdf-assets/mupdf
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs pdf-assets/pdfjs/
cp node_modules/pdfjs-dist/LICENSE pdf-assets/pdfjs/
cp -R node_modules/pdfjs-dist/cmaps node_modules/pdfjs-dist/standard_fonts node_modules/pdfjs-dist/wasm pdf-assets/pdfjs/
cp node_modules/mupdf/dist/mupdf.js node_modules/mupdf/dist/mupdf-wasm.js node_modules/mupdf/dist/mupdf-wasm.wasm node_modules/mupdf/LICENSE pdf-assets/mupdf/
```

After dependency updates, remove the old `pdf-assets/pdfjs/` and `pdf-assets/mupdf/` directories before copying the new versions so removed upstream files do not linger. No install hook or copy script is used.

Choose one asset-hosting setup before starting the app:

### Public bucket / CDN

Copy `.env.example` to `.env.local`. Its example prefix is `https://assets.axtn.io/pdf`; replace it with your own public asset prefix if needed. Upload the **contents** of `pdf-assets/` beneath that prefix, keeping every license file and subdirectory:

```text
https://assets.axtn.io/pdf/pdfjs/pdf.worker.min.mjs
https://assets.axtn.io/pdf/pdfjs/cmaps/...
https://assets.axtn.io/pdf/pdfjs/standard_fonts/...
https://assets.axtn.io/pdf/pdfjs/wasm/...
https://assets.axtn.io/pdf/pdfjs/LICENSE
https://assets.axtn.io/pdf/mupdf/mupdf.js
https://assets.axtn.io/pdf/mupdf/mupdf-wasm.js
https://assets.axtn.io/pdf/mupdf/mupdf-wasm.wasm
https://assets.axtn.io/pdf/mupdf/LICENSE
```

The asset host must allow your app origin through CORS. Serve `.js`/`.mjs` as JavaScript and `.wasm` as `application/wasm`. Configure caching for these public static assets; purge changed URLs when replacing files. Versioned prefixes are recommended for long browser cache lifetimes, since a CDN purge cannot clear browser caches.

For Vercel, set `NEXT_PUBLIC_PDF_ASSET_BASE_URL` in the project's environment settings before building. This public variable is embedded at build time; rebuild/redeploy after changing it. The app never calls the bucket API or uses bucket credentials. Trailing slashes are normalized.

Keep **`public/redaction-worker.mjs` and `public/pdf-background.mjs` on the app's own origin**. They load MuPDF from the configured prefix. User PDFs are never sent to the bucket or to the app server.

### Same-domain assets

Leave `NEXT_PUBLIC_PDF_ASSET_BASE_URL` blank and move the prepared folders into `public/`, preserving their contents:

```sh
mv pdf-assets/pdfjs pdf-assets/mupdf public/
```

The browser will then load `/pdfjs/` and `/mupdf/` from the app itself. Prepare and move fresh copies again after updating dependencies, **before building/deploying** a same-domain installation. The generated public copies remain ignored by Git. If switching back to a bucket, move `public/pdfjs/` and `public/mupdf/` back to `pdf-assets/` so they are not included in the app deployment.

With either setup:

```sh
npm run dev
# Production:
npm run build
npm start
```

No PDF uploads, analytics, server actions, file history, or persistent document storage are implemented. Files and edits stay in browser memory. Next.js prerenders the initial page without receiving document bytes. The browser still requests app resources and engine assets; those requests contain no PDF data.

## Redaction and export

1. PDF.js renders the preview and selectable text layer. Text dragging groups glyphs by their positions into visual lines and columns, instead of following PDF text-object order. A local 70% opacity overlay previews the selection; no browser-wide DOM selection is used. Pointer capture handles release outside the page, and double-click selects whole words across fragmented spans. Text selections and drawn boxes are stored as normalized rectangles, with no added padding around text selections.
2. Opening a valid PDF starts loading and initializing MuPDF and its WASM binary in a dedicated **browser Web Worker**, in the background. Initial page visits do not load this engine. Download reuses that prepared worker and sends a copy of the original PDF bytes and marks; it waits for preparation if needed and retries if the background load failed. Closing the document releases any prepared worker.
3. MuPDF disables embedded JavaScript and bakes visible annotation/form appearances into static page content. Before redacting, it recognizes an initial opaque, uniform rectangular page backdrop. If vector redaction removes that backdrop, export reconstructs only its solid color so white unredacted text remains visible; original text, image pixels, gradients, and decorative paths are never restored. It applies actual content redactions: text characters are removed, covered bitmap pixels are replaced, and intersecting vector artwork is removed. Redaction coordinates account for displayed crop boxes and page rotations through MuPDF's page space.
4. MuPDF's PDF DocumentWriter replays the remaining **text and vector drawing operations** into a fresh PDF. This is not page rasterization. No original document catalog, Info/XMP metadata, bookmarks, attachments, JavaScript actions, form structures, tags, or optional-layer controls are copied. Hidden optional content is excluded by the drawing engine; visible layer content becomes ordinary page content.
5. Existing bitmap images are decoded and losslessly re-encoded to discard embedded image metadata. Original image resources are replaced in the fresh document, then a full rewrite with `garbage=yes,compress=yes` collects unused objects. Generated Info metadata is removed too. No incremental save is used. Object renumbering and deduplication are deliberately disabled: in MuPDF 1.28.1, compaction of rewritten transparency groups can corrupt Form streams and produce blank pages. Plain garbage collection removes unreferenced data without renumbering live objects.
6. The worker returns the new PDF bytes and is terminated. The original is never changed. An export failure returns an error without downloading a fallback PDF.

The “Remove hidden information” checkbox is checked by default for each newly opened PDF. Unchecking it preserves original scalar document Info fields and the raw document XMP metadata. It does not restore attachments, scripts, editable forms, or other interactive structures; those are still excluded by the fresh drawing-only export. The UI explains this distinction. Metadata can contain sensitive information even after page content is redacted.

Unredacted text remains selectable/searchable. Vector graphics remain vector content. Scanned pages remain bitmap images with redacted pixels; OCR text inside marked regions is removed as well. Redactions become permanent in the downloaded `-redacted.pdf`, not the editable preview.

## Limits and review

The new document preserves drawing content, not the original interactive structure. Links, editable forms, comments, bookmarks, accessibility tags, and signatures do not survive as interactive features. Visible form values and annotation appearances remain unless marked for redaction. Entire vector paths that intersect a redaction box may disappear, including a long table border or decorative artwork. Only a recognized solid page-background color is reconstructed. Image streams may get larger, and rendering/font/color differences are possible when writing a fresh PDF. Review every exported page before sharing.

Unmarked ordinary content, including unmarked OCR/invisible text, is not automatically classified as sensitive or removed. Metadata inspection shows original Info/XMP, not every possible structure. Password-protected PDFs require an unlocked copy; repaired/corrupt documents are rejected by the export worker. There is no image-only fallback.

## Viewer zoom

The PDF viewer supports local pinch zoom from fit-width (100%) to 400%, without changing the webpage's zoom. Two fingers pan the document; a blank-area single-finger drag scrolls, while a single finger on text or in box mode still redacts. Beginning a pinch cancels any unfinished text or box selection so it cannot accidentally create a mark. Plus/minus and fit controls provide a keyboard-accessible alternative. Redaction coordinates remain normalized to the original PDF page.

After resizing/zooming settles, the preview canvas redraws at an appropriate resolution, capped at 8192 pixels per side and 16 million pixels per page. This changes only the preview; export still performs non-rasterized content redaction. The mobile test uses actual multi-touch input in Chromium mobile emulation to verify anchoring, pan, reset, cancellation, and exported text removal after touch selection at a zoomed scale.

## Verification

```sh
npm run check
# Prepare assets with the manual instructions above, then move them for local tests:
mv pdf-assets/pdfjs pdf-assets/mupdf public/
NEXT_PUBLIC_PDF_ASSET_BASE_URL= npm test
```

Playwright uses installed Google Chrome. Tests verify:

- Text selection, drawn boxes, undo, export, and reopening.
- Redacted text absent from an independent PDF.js text layer while unredacted text stays selectable.
- Text/font resources preserved instead of whole-page bitmap export.
- Rotated pages, shifted crop boxes, nested Form XObjects, OCR text, and partially covered images.
- Actual embedded bitmap pixels changed under the redaction, uncovered pixels preserved, and other uses of a shared image preserved.
- Intersecting vector removal, hidden optional layers, replacement accessibility text, XMP, attachments, and original Info metadata.
- No document uploads in the local asset configuration, invalid-file recovery, mobile layout, and close-document confirmation accessibility.

## Licensing

Copyright © 2026 Alex Tadevosyan. PDF Redactor is licensed under **AGPL-3.0-or-later**; see [LICENSE](LICENSE). Dependency copyrights and licenses remain their own. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [MUPDF-LICENSE.txt](MUPDF-LICENSE.txt), and [public/licenses/dependencies/](public/licenses/dependencies/).

The footer links to the application's source and license. When deploying a fork or modified build, update the source link to the corresponding source for that exact deployment, including your changes, dependency versions, and build instructions. Provide the corresponding source required for distributed binaries, including the MuPDF WASM runtime and its build inputs; merely publishing a WASM file and a license is not a source offer. The notices identify the upstream source and build instructions for the unmodified MuPDF release used here. Preserve upstream copyright notices and all license files when uploading assets or redistributing builds.

MuPDF's JavaScript wrapper and WASM binary are used under AGPL-3.0-or-later. If you cannot satisfy those terms, obtain an appropriate commercial license from Artifex before distributing/deploying that version. See [Artifex's licensing guidance](https://mupdfjs.readthedocs.io/en/latest/faq/index.html#licensing).

Check current dependency advisories with `npm audit`; use `npm audit --omit=dev` to inspect runtime dependencies separately.

## References

- [MuPDF redaction API](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/PDFPage.html)
- [MuPDF PDF writer](https://mupdf.readthedocs.io/en/latest/reference/javascript/types/DocumentWriter.html)
- [MuPDF save options](https://mupdf.readthedocs.io/en/latest/reference/common/pdf-write-options.html)
- [MuPDF browser usage and licensing](https://mupdfjs.readthedocs.io/en/latest/faq/index.html)
- [Adobe redaction and sanitization](https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/redacting-sanitizing.html)

## Separate-origin asset verification

With the manually prepared assets in `pdf-assets/`, run:

```sh
PDF_REDACTOR_TEST_CDN=1 NEXT_PUBLIC_PDF_ASSET_BASE_URL=http://127.0.0.1:3012/pdf/ npm test -- tests/assets.spec.ts
```

This test serves `pdf-assets/` using a temporary CORS-enabled server. It checks that PDF.js and MuPDF load from that separate origin, the worker loader stays on the app origin, and asset requests use GET. It does not contact the production bucket.

Playwright uses installed Google Chrome and starts its own app on port 3015 with an isolated `.next-test` build directory. It does not reuse or stop the interactive app on port 3000. Override the test port with `PDF_REDACTOR_TEST_PORT`. Local tests require the engine folders in `public/` and a blank asset prefix as shown above. After testing, move them back to `pdf-assets/` if deploying with a bucket.

## Formatting and linting

Prettier formats authored TS, TSX, JS, CSS, JSON, and Markdown with two-space indentation, semicolons, single-quoted JS strings, trailing commas, and a 100-column target. Generated assets, build output, lockfiles, and local environment files are excluded. EditorConfig supplies matching editor defaults.

ESLint uses the Next.js Core Web Vitals and TypeScript configurations, plus mandatory braces, strict equality, `const` preference, type-only imports, and unused-variable checks. Blank-line rules separate functions, imports, control-flow blocks, returns, comments, and multiline operations, while allowing related declarations to stay grouped. Formatting rules are disabled through `eslint-config-prettier` to avoid conflicting tools.

```sh
npm run format        # Reformat authored files
npm run format:check  # Check formatting without changing files
npm run lint          # No warnings allowed
npm run lint:fix      # Apply safe lint fixes
npm run check         # Lint, formatting check, and production build
```
