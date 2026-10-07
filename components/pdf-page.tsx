'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Mark } from '@/lib/pdf';
import {
  measureText,
  hitText,
  selectedGlyphs,
  glyphMarks,
  type TextLine,
} from '@/lib/text-selection';

export default function PdfPage({
  doc,
  number,
  marks,
  tool,
  addMarks,
  registerCancellation,
}: {
  doc: PDFDocumentProxy;
  number: number;
  marks: Mark[];
  tool: 'text' | 'box';
  addMarks: (marks: Mark[]) => void;
  registerCancellation: (page: number, cancel: (() => void) | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 612, height: 792, rotation: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number; endX: number; endY: number } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [pixelScale, setPixelScale] = useState(1.5);
  const textDrag = useRef<{
    lines: TextLine[];
    anchor: { line: number; glyph: number };
    x: number;
    y: number;
    moved: boolean;
    marks: Mark[];
  } | null>(null);
  const [preview, setPreview] = useState<Mark[]>([]);

  const cancelEditing = useCallback(() => {
    textDrag.current = null;
    setDrag(null);
    setPreview([]);
  }, []);

  useEffect(() => {
    registerCancellation(number, cancelEditing);

    return () => registerCancellation(number, null);
  }, [number, registerCancellation, cancelEditing]);

  useEffect(() => {
    const element = area.current;

    if (!element) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      const ratio = element.clientWidth / size.width;

      element.style.setProperty('--page-scale', String(ratio));
      clearTimeout(timer);

      timer = setTimeout(() => {
        const quality = Math.min(
          Math.max(1.5, ratio * Math.min(window.devicePixelRatio, 2)),
          4,
          8192 / Math.max(size.width, size.height),
          Math.sqrt(16000000 / (size.width * size.height)),
        );

        setPixelScale(Math.floor(quality * 20) / 20);
      }, 180);
    });

    observer.observe(element);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [size.width, size.height]);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | undefined;

    async function renderCanvas() {
      const page = await doc.getPage(number);

      if (cancelled || !canvas.current) {
        return;
      }

      const viewport = page.getViewport({ scale: pixelScale });

      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      const rendering = page.render({
        canvas: canvas.current,
        canvasContext: canvas.current.getContext('2d')!,
        viewport,
      });

      task = rendering;
      await rendering.promise;
    }

    renderCanvas().catch((error) => {
      if (!cancelled) {
        setError(error.message || 'Could not display this page.');
      }
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, pixelScale]);

  useEffect(() => {
    let cancelled = false;
    let textLayer: { cancel: () => void } | undefined;

    async function renderText() {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 1 });

      if (cancelled || !layer.current) {
        return;
      }

      setSize({ width: viewport.width, height: viewport.height, rotation: viewport.rotation });
      await page.getOperatorList();
      const { TextLayer } = await import('pdfjs-dist');
      const content = await page.getTextContent();

      if (cancelled || !layer.current) {
        return;
      }

      layer.current.replaceChildren();
      const text = new TextLayer({
        textContentSource: content,
        container: layer.current,
        viewport,
      });

      textLayer = text;
      await text.render();
    }

    renderText().catch((error) => {
      if (!cancelled) {
        setError(error.message || 'Could not display page text.');
      }
    });

    return () => {
      cancelled = true;
      textLayer?.cancel();
    };
  }, [doc, number]);

  function point(event: React.PointerEvent) {
    const rect = area.current!.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function beginText(event: React.PointerEvent) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const lines = measureText(layer.current!);
    const anchor = hitText(lines, event.clientX, event.clientY, true);

    if (!anchor) {
      return;
    }

    textDrag.current = {
      lines,
      anchor,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      marks: [],
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveText(event: React.PointerEvent) {
    const current = textDrag.current;

    if (!current) {
      return;
    }

    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3) {
      return;
    }

    current.moved = true;
    const focus = hitText(current.lines, event.clientX, event.clientY);

    if (!focus) {
      return;
    }

    current.marks = glyphMarks(
      selectedGlyphs(current.lines, current.anchor, focus),
      area.current!.getBoundingClientRect(),
      number,
    );

    setPreview(current.marks);
  }

  function selectWord(event: React.MouseEvent) {
    if (tool !== 'text') {
      return;
    }

    event.preventDefault();
    const lines = measureText(layer.current!);
    const hit = hitText(lines, event.clientX, event.clientY, true);

    if (!hit) {
      return;
    }

    const glyphs = lines[hit.line].glyphs;
    const content = glyphs.map((g) => g.text).join('');
    const offset = glyphs.slice(0, hit.glyph).reduce((sum, glyph) => sum + glyph.text.length, 0);
    const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(content);
    const word = Array.from(segments).find(
      (segment) =>
        segment.isWordLike &&
        offset >= segment.index &&
        offset < segment.index + segment.segment.length,
    );

    if (!word) {
      return;
    }

    let position = 0;
    const selected = glyphs.filter((g) => {
      const start = position;

      position += g.text.length;

      return start < word.index + word.segment.length && position > word.index;
    });

    addMarks(glyphMarks([selected], area.current!.getBoundingClientRect(), number));
  }

  return (
    <div className="page-wrap">
      <div className="page-label">
        PAGE {String(number).padStart(2, '0')}
        <span>
          {marks.length} {marks.length === 1 ? 'mark' : 'marks'}
        </span>
      </div>
      <div
        ref={area}
        className={`pdf-page ${tool}`}
        style={
          {
            aspectRatio: `${size.width}/${size.height}`,
            '--scale-factor': 1,
            '--total-scale-factor': 1,
            '--scale-round-x': '0.01px',
            '--scale-round-y': '0.01px',
          } as React.CSSProperties
        }
        onDoubleClick={selectWord}
        onPointerDown={(e) => {
          if (tool === 'text') {
            beginText(e);

            return;
          }

          if (e.button !== 0) {
            return;
          }

          e.preventDefault();
          const p = point(e);

          setDrag({ ...p, endX: p.x, endY: p.y });
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (tool === 'text') {
            moveText(e);

            return;
          }

          if (drag) {
            const p = point(e);

            setDrag({ ...drag, endX: p.x, endY: p.y });
          }
        }}
        onPointerUp={(e) => {
          if (tool === 'text') {
            moveText(e);

            if (textDrag.current?.moved) {
              addMarks(textDrag.current.marks);
            }

            textDrag.current = null;
            setPreview([]);

            return;
          }

          if (!drag) {
            return;
          }

          const p = point(e);
          const w = Math.abs(p.x - drag.x),
            h = Math.abs(p.y - drag.y);

          if (w > 0.003 && h > 0.003) {
            addMarks([
              {
                id: crypto.randomUUID(),
                page: number,
                x: Math.min(p.x, drag.x),
                y: Math.min(p.y, drag.y),
                w,
                h,
              },
            ]);
          }

          setDrag(null);
        }}
        onPointerCancel={() => {
          setDrag(null);
          textDrag.current = null;
          setPreview([]);
          window.getSelection()?.removeAllRanges();
        }}
      >
        <canvas ref={canvas} aria-label={`PDF page ${number}`} />
        <div
          ref={layer}
          className="textLayer"
          style={{
            width: size.width,
            height: size.height,
            transform: `scale(var(--page-scale)) rotate(${size.rotation}deg) ${size.rotation === 90 ? 'translateY(-100%)' : size.rotation === 180 ? 'translate(-100%, -100%)' : size.rotation === 270 ? 'translateX(-100%)' : ''}`,
            transformOrigin: 'top left',
          }}
        />
        {preview.map((m) => (
          <div
            key={m.id}
            className="drawing-mark text-selection-preview"
            style={{
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              width: `${m.w * 100}%`,
              height: `${m.h * 100}%`,
            }}
          />
        ))}
        {marks.map((m) => (
          <div
            key={m.id}
            className="redaction-mark"
            style={{
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              width: `${m.w * 100}%`,
              height: `${m.h * 100}%`,
            }}
          />
        ))}
        {drag && (
          <div
            className="drawing-mark"
            style={{
              left: `${Math.min(drag.x, drag.endX) * 100}%`,
              top: `${Math.min(drag.y, drag.endY) * 100}%`,
              width: `${Math.abs(drag.endX - drag.x) * 100}%`,
              height: `${Math.abs(drag.endY - drag.y) * 100}%`,
            }}
          />
        )}
        {error && (
          <div className="page-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
