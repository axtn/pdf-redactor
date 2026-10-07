# Third-party notices

PDF Redactor's application code is copyright © 2026 Alex Tadevosyan and licensed under AGPL-3.0-or-later. Dependencies retain their original copyright notices and licenses; the application license does not replace them.

## MuPDF.js

The installed runtime is MuPDF.js **1.28.1**, copyright © 2004–2026 Artifex Software, Inc., licensed under **AGPL-3.0-or-later**. The unmodified license is retained in [MUPDF-LICENSE.txt](MUPDF-LICENSE.txt), and the manual asset instructions copy the installed package's license to `pdf-assets/mupdf/LICENSE` (or `public/mupdf/LICENSE` for same-domain hosting).

- [MuPDF 1.28.1 source](https://github.com/ArtifexSoftware/mupdf/tree/1.28.1), including the JavaScript platform bindings, build tools, and referenced third-party sources.
- [Official source repository](https://cgit.ghostscript.com/mupdf.git/).
- [JavaScript build instructions](https://mupdf.readthedocs.io/en/latest/building-from-source.html).
- [Artifex licensing guidance](https://mupdfjs.readthedocs.io/en/latest/faq/index.html#licensing).

AGPL applies to both the JavaScript wrapper and the WASM binary. Distributing the combined application requires providing the applicable corresponding source under AGPL-compatible terms and preserving copyright and license notices. A deployed modified application must offer its corresponding source to users as required by AGPL section 13. Keep that offer pointed at the source for the deployed version, including local modifications and build instructions. Retain the matching upstream source and build inputs for the engine binaries you distribute; a generic link to the latest upstream version does not identify a matching release. Commercial licensing is available from Artifex when AGPL terms cannot be met.

## PDF.js and its bundled assets

PDF.js **6.4.299** is distributed under Apache-2.0. Its license is retained in [public/licenses/dependencies/PDFJS.txt](public/licenses/dependencies/PDFJS.txt) and must accompany the runtime at `pdf-assets/pdfjs/LICENSE`.

- [PDF.js source](https://github.com/mozilla/pdf.js).
- `cmaps/LICENSE` accompanies the CMaps.
- `standard_fonts/LICENSE_FOXIT` and `standard_fonts/LICENSE_LIBERATION` accompany the bundled fonts.
- `wasm/LICENSE_*` files accompany the image codecs and color-management components, including their upstream licenses and copyright notices.

The manual asset instructions copy these directories intact. Upload or redistribute the license files along with their assets; do not upload only the JS/WASM binaries.

## Other bundled dependencies and fonts

Original license texts are retained in [public/licenses/dependencies/](public/licenses/dependencies/) and served individually at `/licenses/dependencies/<filename>` as checked-in static documents:

| Component     | License                           | Retained notice     |
| ------------- | --------------------------------- | ------------------- |
| Next.js       | MIT                               | `Next.txt`          |
| React         | MIT                               | `React.txt`         |
| React DOM     | MIT                               | `ReactDOM.txt`      |
| pdf-lib       | MIT                               | `PDFLib.txt`        |
| Lucide        | ISC, with Feather MIT attribution | `Lucide.txt`        |
| DM Sans       | SIL Open Font License 1.1         | `DM-Sans.txt`       |
| Space Grotesk | SIL Open Font License 1.1         | `Space-Grotesk.txt` |

Fonts are downloaded at build time by `next/font` and served by the app. Their upstream license sources are [Google Fonts DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans) and [Google Fonts Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk).

Additional transitive and build dependencies retain the notices included in their packages. Preserve those notices in redistributed bundles and review changed dependency licenses when upgrading. The checked-in lockfile identifies the dependency versions used by this application.
