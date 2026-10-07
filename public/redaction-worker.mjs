import { pageBackground, drawBackground } from './pdf-background.mjs';

// Keep the original document in this worker only for this export. Never save incrementally.
self.onmessage = async ({
  data: { type, bytes, marks, removeHiddenInformation = true, engineModuleUrl },
}) => {
  let source, writer, drawingBuffer, output, saved, verified;
  const replacements = new Map();

  try {
    const mupdf = await import(engineModuleUrl ?? './mupdf/mupdf.js');

    if (type === 'preload') {
      self.postMessage({ type: 'ready' });

      return;
    }

    source = new mupdf.PDFDocument(new Uint8Array(bytes));
    source.disableJS();

    if (source.needsPassword()) {
      throw new Error('Open an unlocked copy of this PDF.');
    }

    if (source.wasRepaired()) {
      throw new Error('This PDF required repair. Export an intact copy before redacting it.');
    }

    // Preserve visible appearances without retaining form values, comments, or interactive objects.
    source.bake(true, true);
    drawingBuffer = new mupdf.Buffer();
    writer = new mupdf.DocumentWriter(drawingBuffer, 'pdf', 'compress=yes');

    for (let index = 0; index < source.countPages(); index++) {
      self.postMessage({ type: 'progress', page: index + 1 });
      const page = source.loadPage(index);

      try {
        const bounds = page.getBounds();
        const width = bounds[2] - bounds[0],
          height = bounds[3] - bounds[1];

        const pageMarks = marks.filter((mark) => mark.page === index + 1);
        const background = pageMarks.length ? pageBackground(mupdf, page, bounds) : null;

        for (const mark of pageMarks) {
          if (
            ![mark.x, mark.y, mark.w, mark.h].every(Number.isFinite) ||
            mark.w <= 0 ||
            mark.h <= 0
          ) {
            throw new Error('Invalid redaction region.');
          }

          const annotation = page.createAnnotation('Redact');

          annotation.setRect([
            bounds[0] + Math.max(0, mark.x) * width,
            bounds[1] + Math.max(0, mark.y) * height,
            bounds[0] + Math.min(1, mark.x + mark.w) * width,
            bounds[1] + Math.min(1, mark.y + mark.h) * height,
          ]);

          annotation.setColor([0, 0, 0]);
          annotation.update();
          annotation.destroy();
        }

        if (pageMarks.length) {
          page.applyRedactions(
            true,
            mupdf.PDFPage.REDACT_IMAGE_PIXELS,
            mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_TOUCHED,
            mupdf.PDFPage.REDACT_TEXT_REMOVE,
          );
        }

        // Replay drawing operations into a fresh PDF, not a page bitmap. This also excludes
        // document-level metadata, attachments, scripts, structure trees, and optional-layer controls.
        const device = writer.beginPage([0, 0, width, height]);

        try {
          // MuPDF removes a whole vector path when a redaction touches it. Restore
          // only the recognized uniform page color, never original drawing data.
          drawBackground(mupdf, device, background, width, height);
          page.runPageContents(device, [1, 0, 0, 1, -bounds[0], -bounds[1]]);
          device.close();
        } finally {
          device.destroy();
        }

        writer.endPage();
      } finally {
        page.destroy();
      }
    }

    writer.close();
    output = new mupdf.PDFDocument(drawingBuffer);

    // Decode and losslessly re-encode existing bitmap images only, removing JPEG/EXIF
    // and embedded image metadata. Text and vector drawing operations remain vector content.
    const originalCount = output.countObjects();

    for (let index = 1; index < originalCount; index++) {
      const object = output.newIndirect(index);
      let image, pixmap, cleanImage;

      try {
        if (!object.isStream()) {
          continue;
        }

        const subtype = object.get('Subtype');
        const isImage = subtype.asName() === 'Image';

        subtype.destroy();

        if (!isImage) {
          continue;
        }

        image = output.loadImage(object);
        pixmap = image.toPixmap();
        cleanImage = new mupdf.Image(pixmap);
        replacements.set(index, output.addImage(cleanImage));
      } finally {
        cleanImage?.destroy();
        pixmap?.destroy();
        image?.destroy();
        object.destroy();
      }
    }

    // Replace resource references rather than overwriting an image stream's object identity.
    // The full rewrite below then collects every unreferenced original image.
    function replaceImageReferences(object, depth = 0) {
      if (depth > 64) {
        throw new Error('This PDF has unsupported deeply nested drawing resources.');
      }

      if (!object.isDictionary() && !object.isArray()) {
        return;
      }

      object.forEach((value, key) => {
        try {
          if (value.isIndirect()) {
            const replacement = replacements.get(value.asIndirect());

            if (replacement) {
              object.put(key, replacement);
            }
          } else {
            replaceImageReferences(value, depth + 1);
          }
        } finally {
          value.destroy();
        }
      });
    }

    for (let index = 1; index < output.countObjects(); index++) {
      const reference = output.newIndirect(index);
      const object = reference.resolve();

      try {
        replaceImageReferences(object);
      } finally {
        object.destroy();
        reference.destroy();
      }
    }

    const trailer = output.getTrailer();
    const root = trailer.get('Root');

    try {
      trailer.delete('Info');
      trailer.delete('ID');
      root.delete('Info');
      root.delete('Metadata');
    } finally {
      root.destroy();
      trailer.destroy();
    }

    if (!removeHiddenInformation) {
      // Preserve document metadata only. Never graft a source object graph containing
      // attachments, actions, forms, or original page content back into the redacted PDF.
      const sourceTrailer = source.getTrailer();
      const originalInfo = sourceTrailer.get('Info');
      const info = output.newDictionary();
      const destinationTrailer = output.getTrailer();

      try {
        originalInfo.forEach((value, key) => {
          const scalar = value.resolve();

          try {
            if (scalar.isString() || scalar.isName() || scalar.isNumber() || scalar.isBoolean()) {
              const copied = output.graftObject(scalar);

              try {
                info.put(key, copied);
              } finally {
                copied.destroy();
              }
            }
          } finally {
            scalar.destroy();
            value.destroy();
          }
        });

        if (info.toString() !== '<<>>') {
          const reference = output.addObject(info);

          try {
            destinationTrailer.put('Info', reference);
          } finally {
            reference.destroy();
          }
        }

        const originalXmp = sourceTrailer.get('Root', 'Metadata');

        try {
          if (originalXmp.isStream()) {
            const contents = originalXmp.readStream();

            try {
              const copied = output.addStream(contents, { Type: 'Metadata', Subtype: 'XML' });
              const catalog = destinationTrailer.get('Root');

              try {
                catalog.put('Metadata', copied);
              } finally {
                catalog.destroy();
                copied.destroy();
              }
            } finally {
              contents.destroy();
            }
          }
        } finally {
          originalXmp.destroy();
        }
      } finally {
        destinationTrailer.destroy();
        info.destroy();
        originalInfo.destroy();
        sourceTrailer.destroy();
      }
    }

    // Remove unused objects without renumbering live streams. In MuPDF 1.28.1,
    // compaction after rewriting transparency resources can turn Form streams into
    // ordinary dictionaries, leaving designed PDFs blank. Garbage collection alone
    // still excludes unreferenced original image data from the serialized file.
    saved = output.saveToBuffer('garbage=yes,compress=yes');

    // Check the serialized document, rather than just the in-memory objects. A Form
    // or Image XObject must remain a stream after saving; otherwise viewers can
    // silently render a blank page. Refuse to download that invalid result.
    verified = new mupdf.PDFDocument(saved);

    for (let index = 1; index < verified.countObjects(); index++) {
      const object = verified.newIndirect(index);

      try {
        if (!object.isDictionary()) {
          continue;
        }

        const subtype = object.get('Subtype');

        try {
          if (['Form', 'Image'].includes(subtype.asName()) && !object.isStream()) {
            throw new Error('Export produced an invalid drawing stream. No file was downloaded.');
          }
        } finally {
          subtype.destroy();
        }
      } finally {
        object.destroy();
      }
    }

    const result = new Uint8Array(saved.asUint8Array());

    self.postMessage({ type: 'result', bytes: result.buffer }, [result.buffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Redaction failed. No file was exported.',
    });
  } finally {
    for (const reference of replacements.values()) {
      reference.destroy();
    }

    verified?.destroy();
    saved?.destroy();
    output?.destroy();
    writer?.destroy();
    drawingBuffer?.destroy();
    source?.destroy();
  }
};
